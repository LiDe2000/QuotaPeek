//! Browser account authorization and read-only wallet queries.
//! Protocol reference: deepseek-ai/deepseek-harness, deepseek-account-platform.
use crate::deepseek::{error, Account, Balance, DeepseekState, Error};
use crate::deepseek_wallet::Decimal;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{watch, Mutex},
};

const ORIGIN: &str = "https://platform.deepseek.com";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Grant {
    token: String,
    user_id: String,
    label: String,
    contact: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Poll {
    status: &'static str,
    message: Option<String>,
    account_id: Option<String>,
}
struct Flow {
    result: Mutex<Poll>,
    cancel: watch::Sender<bool>,
    created: Instant,
}
#[derive(Default)]
pub struct LoginState {
    flows: Mutex<HashMap<String, Arc<Flow>>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Start {
    state: String,
    auth_url: String,
}

fn protocol() -> Error {
    error("DeepSeek returned an unsupported account response. Please retry later.")
}
fn client() -> Result<reqwest::Client, Error> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("QuotaPeek/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| error("Could not initialize the DeepSeek connection."))
}
fn headers(request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    let platform = if cfg!(windows) {
        "desktop-win"
    } else if cfg!(target_os = "macos") {
        "desktop-mac"
    } else {
        "web"
    };
    request
        .header("x-client-bundle-id", "")
        .header("x-client-platform", platform)
        .header("x-client-version", env!("CARGO_PKG_VERSION"))
        .header("x-client-locale", "en_US")
        .header(
            "x-client-timezone-offset",
            chrono::Local::now().offset().local_minus_utc().to_string(),
        )
}
fn unwrap_payload(value: Value) -> Result<Value, Error> {
    if value.get("code").and_then(Value::as_i64) == Some(40003)
        || value.get("code").and_then(Value::as_i64) == Some(40002)
    {
        return Err(error(
            "DeepSeek sign-in expired. Sign in again from the account panel.",
        ));
    }
    if value.get("code").and_then(Value::as_i64) != Some(0)
        || value.pointer("/data/biz_code").and_then(Value::as_i64) != Some(0)
    {
        return Err(protocol());
    }
    value
        .pointer("/data/biz_data")
        .cloned()
        .ok_or_else(protocol)
}
async fn response(request: reqwest::RequestBuilder) -> Result<Value, Error> {
    let mut result = headers(request)
        .send()
        .await
        .map_err(|_| error("Could not reach DeepSeek. Check your connection and retry."))?;
    if result.status().as_u16() == 401 {
        return Err(error("DeepSeek sign-in expired. Please sign in again."));
    }
    if !result.status().is_success() {
        return Err(error(
            "DeepSeek could not complete this request. Please retry later.",
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = result.chunk().await.map_err(|_| protocol())? {
        if bytes.len() + chunk.len() > 65536 {
            return Err(protocol());
        }
        bytes.extend_from_slice(&chunk);
    }
    unwrap_payload(serde_json::from_slice(&bytes).map_err(|_| protocol())?)
}
async fn auth(client: &reqwest::Client, method: &str, body: Value) -> Result<Value, Error> {
    response(
        client
            .post(format!("{ORIGIN}/auth-api/v0/dsh/{method}"))
            .json(&body),
    )
    .await
}
fn browser_url(value: &str, expected_path: &str) -> Result<String, Error> {
    let url = reqwest::Url::parse(value).map_err(|_| protocol())?;
    if url.origin().ascii_serialization() != ORIGIN
        || url.path() != expected_path
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(protocol());
    }
    Ok(url.into())
}
fn random() -> Result<String, Error> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| error("Could not initialize secure sign-in."))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
fn profile(value: &Value) -> Result<(String, String, Option<String>), Error> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(protocol)?
        .to_owned();
    let contact = ["mobile", "mobile_number", "email"]
        .iter()
        .find_map(|key| {
            value
                .get(key)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
        })
        .map(str::to_owned);
    let label = value
        .pointer("/id_profile/name")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .or_else(|| contact.clone())
        .unwrap_or_else(|| "DeepSeek account".into());
    Ok((id, label, contact))
}
#[derive(Deserialize)]
struct Wallet {
    currency: String,
    balance: String,
}
#[derive(Deserialize)]
struct Summary {
    normal_wallets: Vec<Wallet>,
    bonus_wallets: Vec<Wallet>,
    #[serde(default)]
    total_costs: Vec<Cost>,
}
#[derive(Deserialize)]
struct Cost {
    currency: String,
    amount: String,
}
fn balances(value: Value) -> Result<Vec<Balance>, Error> {
    let value: Summary = serde_json::from_value(value).map_err(|_| protocol())?;
    let mut totals: Vec<(String, Decimal, Decimal)> = Vec::new();
    for (bonus, wallets) in [(false, value.normal_wallets), (true, value.bonus_wallets)] {
        for wallet in wallets {
            if !matches!(wallet.currency.as_str(), "CNY" | "USD") {
                return Err(protocol());
            }
            let amount = Decimal::parse(&wallet.balance).ok_or_else(protocol)?;
            let index = match totals
                .iter()
                .position(|(currency, _, _)| currency == &wallet.currency)
            {
                Some(index) => index,
                None => {
                    totals.push((
                        wallet.currency,
                        Decimal::parse("0").unwrap(),
                        Decimal::parse("0").unwrap(),
                    ));
                    totals.len() - 1
                }
            };
            let target = if bonus {
                &mut totals[index].2
            } else {
                &mut totals[index].1
            };
            *target = target.add(amount).ok_or_else(protocol)?;
        }
    }
    if totals.is_empty() {
        return Err(protocol());
    }
    totals
        .into_iter()
        .map(|(currency, paid, bonus)| {
            let mut cost: Option<Decimal> = None;
            for entry in value
                .total_costs
                .iter()
                .filter(|entry| entry.currency == currency)
            {
                let amount = Decimal::parse(&entry.amount).ok_or_else(protocol)?;
                if amount.text().starts_with('-') {
                    return Err(protocol());
                }
                cost = Some(match cost {
                    Some(total) => total.add(amount).ok_or_else(protocol)?,
                    None => amount,
                });
            }
            Ok(Balance {
                total_cost: cost.map(|amount| amount.text()),
                currency,
                total_balance: paid.add(bonus).ok_or_else(protocol)?.text(),
                granted_balance: bonus.text(),
                topped_up_balance: paid.text(),
            })
        })
        .collect()
}
pub(super) fn list_accounts(app: &tauri::AppHandle) -> Result<Vec<Account>, Error> {
    Ok(crate::account_store::read::<Grant>(app, "deepseek-platform")
        .map_err(|message| error(&message))?
        .into_iter()
        .map(|entry| {
            crate::deepseek::platform_snapshot(
                entry.id,
                entry.auth.label,
                entry.auth.contact,
                vec![],
                0,
            )
        })
        .collect())
}
pub(super) async fn query_account(app: &tauri::AppHandle, id: &str) -> Result<Account, Error> {
    let entry = {
        let state = app.state::<DeepseekState>();
        let _guard = state.0.lock().await;
        crate::account_store::load::<Grant>(app, "deepseek-platform", Some(id))
            .map_err(|message| error(&message))?
            .ok_or_else(|| error("DeepSeek account not found. Sign in again."))?
    };
    let client = client()?;
    let user = response(
        client
            .get(format!("{ORIGIN}/auth-api/v0/users/current"))
            .header("x-dsh-auth-token", &entry.auth.token),
    )
    .await?;
    let (user_id, label, contact) = profile(&user)?;
    if user_id != entry.auth.user_id {
        return Err(error("DeepSeek account identity changed. Sign in again."));
    }
    let value = response(
        client
            .get(format!("{ORIGIN}/api/v0/users/get_user_summary"))
            .header("x-dsh-auth-token", &entry.auth.token),
    )
    .await?;
    Ok(crate::deepseek::platform_snapshot(
        entry.id,
        label,
        contact,
        balances(value)?,
        crate::deepseek::now_secs(),
    ))
}

fn callback(request: &str, state: &str) -> Option<String> {
    let line = request.lines().next()?;
    let mut parts = line.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    if !target.starts_with("/oauth/callback?") {
        return None;
    }
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    let params: Vec<_> = url.query_pairs().collect();
    let states: Vec<_> = params.iter().filter(|(key, _)| key == "state").collect();
    let codes: Vec<_> = params.iter().filter(|(key, _)| key == "code").collect();
    if states.len() != 1 || codes.len() != 1 || codes[0].1.is_empty() {
        return None;
    }
    let received = states[0].1.as_bytes();
    let expected = state.as_bytes();
    if received.len() != expected.len()
        || received
            .iter()
            .zip(expected)
            .fold(0_u8, |diff, (a, b)| diff | (a ^ b))
            != 0
    {
        return None;
    }
    Some(codes[0].1.to_string())
}
async fn receive(listener: &TcpListener, state: &str) -> Result<(String, TcpStream), Error> {
    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|_| error("Could not receive the browser sign-in callback."))?;
        let mut bytes = Vec::new();
        let read = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let mut buffer = [0_u8; 1024];
                let size = stream.read(&mut buffer).await.ok()?;
                if size == 0 || bytes.len() + size > 8192 {
                    return None;
                }
                bytes.extend_from_slice(&buffer[..size]);
                if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            callback(std::str::from_utf8(&bytes).ok()?, state)
        })
        .await
        .ok()
        .flatten();
        if let Some(code) = read {
            return Ok((code, stream));
        }
        let _ = stream
            .write_all(
                b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .await;
    }
}
async fn reply(stream: &mut TcpStream, success_url: Option<&str>) {
    let reply = match success_url {
        Some(url) => format!("HTTP/1.1 302 Found\r\nLocation: {url}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
        None => "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\n\r\nSign-in did not complete. Return to QuotaPeek and try again.".into(),
    };
    let _ = stream.write_all(reply.as_bytes()).await;
}
#[tauri::command]
pub async fn deepseek_start_login(
    state: tauri::State<'_, LoginState>,
    app: tauri::AppHandle,
) -> Result<Start, Error> {
    let mut flows = state.flows.lock().await;
    flows.retain(|_, flow| flow.created.elapsed() < Duration::from_secs(660));
    if flows.values().any(|flow| {
        !*flow.cancel.borrow()
            && flow
                .result
                .try_lock()
                .map_or(true, |result| result.status == "pending")
    }) {
        return Err(error(
            "A DeepSeek sign-in is already running. Cancel it before starting another.",
        ));
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| error("Could not open the local sign-in callback. Please retry."))?;
    let redirect_uri = format!(
        "http://127.0.0.1:{}/oauth/callback",
        listener.local_addr().map_err(|_| protocol())?.port()
    );
    let verifier = random()?;
    let csrf = random()?;
    let client = client()?;
    let init = auth(&client, "auth_init", json!({ "code_challenge": URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())), "code_challenge_method": "S256", "state": csrf, "redirect_uri": redirect_uri, "locale": "en_US", "login_source": "desktop" })).await?;
    let auth_url = browser_url(
        init.get("authorize_url")
            .and_then(Value::as_str)
            .ok_or_else(protocol)?,
        "/dsh/authorize",
    )?;
    let authorize_id = init
        .get("authorize_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(protocol)?
        .to_owned();
    let ttl = init
        .get("expires_in")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(protocol)?
        .min(600.0);
    let (cancel, mut cancelled) = watch::channel(false);
    let flow = Arc::new(Flow {
        result: Mutex::new(Poll {
            status: "pending",
            message: None,
            account_id: None,
        }),
        cancel,
        created: Instant::now(),
    });
    let id = random()?;
    flows.insert(id.clone(), flow.clone());
    drop(flows);
    tauri::async_runtime::spawn(async move {
        let mut browser: Option<TcpStream> = None;
        let task = async {
            let (code, stream) = receive(&listener, &csrf).await?;
            browser = Some(stream);
            let device_id = app.state::<crate::storage::Database>()
                .setting_or_insert("device.deepseek", &uuid::Uuid::new_v4().to_string())
                .map_err(|message| error(&message))?;
            let device_id = uuid::Uuid::parse_str(&device_id)
                .map_err(|_| error("Saved DeepSeek device identity is unreadable."))?.to_string();
            let exchange = auth(&client, "auth_exchange", json!({ "code": code, "code_verifier": verifier, "redirect_uri": redirect_uri, "device_id": device_id,
                "device_model": format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH), "os_version": std::env::consts::OS })).await?;
            let token = exchange
                .get("token")
                .and_then(Value::as_str)
                .filter(|value| {
                    !value.is_empty() && value.bytes().all(|byte| (33..=126).contains(&byte))
                })
                .ok_or_else(protocol)?
                .to_owned();
            let completed = browser_url(
                exchange
                    .get("authorized_url")
                    .and_then(Value::as_str)
                    .ok_or_else(protocol)?,
                "/dsh/authorized",
            )?;
            let mut completed = reqwest::Url::parse(&completed).map_err(|_| protocol())?;
            completed
                .query_pairs_mut()
                .append_pair("login_source", "desktop");
            let completed = completed.to_string();
            let user = match exchange.get("user").and_then(|user| profile(user).ok()) {
                Some(user) => user,
                None => profile(
                    &response(
                        client
                            .get(format!("{ORIGIN}/auth-api/v0/users/current"))
                            .header("x-dsh-auth-token", &token),
                    )
                    .await?,
                )?,
            };
            Ok::<_, Error>((
                Grant {
                    token,
                    user_id: user.0,
                    label: user.1,
                    contact: user.2,
                },
                completed,
            ))
        };
        let outcome = tokio::select! {
            result = tokio::time::timeout(Duration::from_secs_f64(ttl), task) => result.unwrap_or_else(|_| Err(error("DeepSeek sign-in timed out. Start again when ready."))),
            _ = cancelled.changed() => Err(error("DeepSeek sign-in cancelled.")),
        };
        let mut result = flow.result.lock().await;
        let outcome = match outcome {
            Ok((grant, completed)) if !*cancelled.borrow() => {
                let storage = app.state::<DeepseekState>();
                let _guard = storage.0.lock().await;
                if *cancelled.borrow() {
                    Err(error("DeepSeek sign-in cancelled."))
                } else {
                    let id = crate::account_store::key("deepseek-account", &grant.user_id);
                    crate::account_store::upsert(&app, "deepseek-platform", id.clone(), grant)
                        .map_err(|message| error(&message))
                        .map(|_| (id, completed))
                }
            }
            Ok(_) => Err(error("DeepSeek sign-in cancelled.")),
            Err(failure) => Err(failure),
        };
        let success_url = match outcome {
            Ok((id, url)) => {
                *result = Poll {
                    status: "success",
                    message: None,
                    account_id: Some(id),
                };
                Some(url)
            }
            Err(failure) => {
                *result = Poll {
                    status: "error",
                    message: Some(failure.message),
                    account_id: None,
                };
                None
            }
        };
        drop(result);
        if let Some(mut stream) = browser {
            reply(&mut stream, success_url.as_deref()).await;
        }
        if success_url.is_none() {
            let _ = auth(
                &client,
                "auth_cancel",
                json!({ "authorize_id": authorize_id, "code_verifier": verifier }),
            )
            .await;
        }
    });
    Ok(Start {
        state: id,
        auth_url,
    })
}
#[tauri::command]
pub async fn deepseek_poll_login(
    state: tauri::State<'_, LoginState>,
    login_state: String,
) -> Result<Poll, Error> {
    let flow = state
        .flows
        .lock()
        .await
        .get(&login_state)
        .cloned()
        .ok_or_else(|| error("DeepSeek sign-in expired. Please start again."))?;
    let result = flow.result.lock().await.clone();
    Ok(result)
}
#[tauri::command]
pub async fn deepseek_cancel_login(
    state: tauri::State<'_, LoginState>,
    login_state: String,
) -> Result<Option<String>, Error> {
    let flow = state.flows.lock().await.get(&login_state).cloned();
    let Some(flow) = flow else {
        return Ok(None);
    };
    let result = flow.result.lock().await;
    if result.status == "success" {
        return Ok(result.account_id.clone());
    }
    let _ = flow.cancel.send(true);
    Ok(None)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires network; creates and immediately cancels an authorization attempt without signing in"]
    async fn live_authorization_initialization() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client = client().ok().unwrap();
        let verifier = random().ok().unwrap();
        let redirect_uri = format!(
            "http://127.0.0.1:{}/oauth/callback",
            listener.local_addr().unwrap().port()
        );
        let init = auth(&client, "auth_init", json!({"code_challenge": URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())), "code_challenge_method":"S256", "state":random().ok().unwrap(), "redirect_uri":redirect_uri, "locale":"en_US", "login_source":"desktop"})).await;
        let init = init.unwrap_or_else(|failure| panic!("{}", failure.message));
        let cancel = auth(
            &client,
            "auth_cancel",
            json!({"authorize_id":init["authorize_id"], "code_verifier":verifier}),
        )
        .await;
        assert!(
            cancel.is_ok(),
            "Could not cancel the test authorization attempt"
        );
        assert!(browser_url(init["authorize_url"].as_str().unwrap(), "/dsh/authorize").is_ok());
    }
    #[test]
    fn callback_rejects_wrong_state_duplicate_values_and_wrong_paths() {
        assert_eq!(
            callback("GET /oauth/callback?state=abc&code=one HTTP/1.1\r\n", "abc"),
            Some("one".into())
        );
        for target in [
            "/oauth/callback?state=bad&code=one",
            "/oauth/callback?state=abc&state=abc&code=one",
            "/oauth/callback?state=abc&code=one&code=two",
            "/wrong?state=abc&code=one",
        ] {
            assert!(callback(&format!("GET {target} HTTP/1.1"), "abc").is_none());
        }
    }
    #[test]
    fn returned_browser_destinations_stay_on_the_platform() {
        assert!(browser_url(
            "https://platform.deepseek.com/dsh/authorize?state=abc",
            "/dsh/authorize"
        )
        .is_ok());
        for url in [
            "https://evil.example/dsh/authorize",
            "http://platform.deepseek.com/dsh/authorize",
            "https://platform.deepseek.com/other",
            "https://user@platform.deepseek.com/dsh/authorize",
        ] {
            assert!(browser_url(url, "/dsh/authorize").is_err());
        }
    }
    #[test]
    fn summary_preserves_debt_and_separate_currencies() {
        let value = balances(json!({ "normal_wallets": [{"currency":"CNY","balance":"-0.0200000000000000"},{"currency":"USD","balance":"1.00"}], "bonus_wallets":[{"currency":"CNY","balance":"6.0000000000000000"}] })).ok().unwrap();
        assert_eq!(value[0].total_balance, "5.98");
        assert_eq!(value[0].topped_up_balance, "-0.02");
        assert_eq!(value[1].total_balance, "1");
        assert!(value[0].total_cost.is_none());
    }
    #[test]
    fn summary_projects_cumulative_cost_by_currency_without_inventing_zero() {
        let value = balances(json!({
            "normal_wallets": [{"currency":"CNY","balance":"-0.02"}, {"currency":"USD","balance":"2"}],
            "bonus_wallets": [{"currency":"CNY","balance":"6"}],
            "total_costs": [{"currency":"CNY","amount":"1.005"}, {"currency":"CNY","amount":"0.005"}]
        })).ok().unwrap();
        assert_eq!(value[0].total_cost.as_deref(), Some("1.01"));
        assert!(value[1].total_cost.is_none());
        for amount in ["NaN", "-1"] {
            assert!(balances(json!({
                "normal_wallets": [{"currency":"CNY","balance":"1"}], "bonus_wallets": [],
                "total_costs": [{"currency":"CNY","amount":amount}]
            }))
            .is_err());
        }
    }
    #[test]
    fn expired_sessions_and_business_errors_do_not_become_balances() {
        assert!(unwrap_payload(json!({"code":40003})).is_err());
        assert!(unwrap_payload(json!({"code":0,"data":{"biz_code":1,"biz_data":{}}})).is_err());
        assert!(profile(&json!({"email":"masked@example.com"})).is_err());
    }
}
