//! WorkBuddy (Tencent) credits over the official CLI-style OAuth flow.
//!
//! Login follows the same protocol as the WorkBuddy CLI:
//! state request -> browser sign-in -> token polling. Only read-only
//! billing endpoints are called, with the CLI's client fingerprint, and
//! quota queries are rate-limited to stay invisible to abuse heuristics.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

const AUTH_HOST: &str = "https://copilot.tencent.com";
const CLIENT_UA: &str = "CLI/2.63.2 CodeBuddy/2.63.2";
const SITE_ORIGIN: &str = "https://www.workbuddy.cn";
const BILLING_CN: &str = "https://www.workbuddy.cn";
const BILLING_GLOBAL: &str = "https://www.workbuddy.ai";
/// Refresh the access token this long before it actually expires.
const TOKEN_REFRESH_MARGIN: u64 = 24 * 3600;
/// Minimum spacing between billing queries; manual refresh stays user-paced.
const MIN_QUERY_INTERVAL: Duration = Duration::from_secs(10);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryError {
    code: &'static str,
    message: String,
}
fn error(code: &'static str, message: impl Into<String>) -> QueryError {
    QueryError { code, message: message.into() }
}
fn protocol_error() -> QueryError {
    error("protocol", "WorkBuddy returned an unsupported response. Retry later.")
}

pub struct WorkbuddyState {
    /// Serializes billing queries so overlapping refreshes cannot race.
    lock: Mutex<()>,
    last_query: Mutex<Option<Instant>>,
    flows: Mutex<HashSet<String>>,
    storage: Mutex<()>,
    completed: Mutex<HashMap<String, String>>,
    http: reqwest::Client,
}
impl Default for WorkbuddyState {
    fn default() -> Self {
        Self { lock: Mutex::default(), last_query: Mutex::default(), flows: Mutex::default(), storage: Mutex::default(), completed: Mutex::default(), http: Self::client() }
    }
}
impl WorkbuddyState {
    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(CLIENT_UA)
            .timeout(Duration::from_secs(20))
            .build()
            .expect("reqwest client")
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStart {
    state: String,
    auth_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollOutcome {
    /// "pending" | "success" | "error"
    status: &'static str,
    message: Option<String>,
    account_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredAuth {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    domain: String,
    uid: String,
    nickname: String,
    enterprise_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbuddyPackage {
    name: String,
    remain: f64,
    used: f64,
    size: f64,
    end_time: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbuddyAccount {
    id: String,
    provider_id: &'static str,
    source: &'static str,
    uid: Option<String>,
    nickname: Option<String>,
    region: &'static str,
    fetched_at: u64,
    total_remain: f64,
    total_used: f64,
    total_size: f64,
    packages: Vec<WorkbuddyPackage>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn account_id(auth: &StoredAuth) -> String {
    crate::storage::accounts::key("workbuddy", &format!("{}:{}:{}", region_of(&auth.domain), auth.uid, auth.enterprise_id))
}

fn stored_accounts(app: &tauri::AppHandle) -> Result<Vec<crate::storage::accounts::Entry<StoredAuth>>, QueryError> {
    crate::storage::accounts::read(app, "workbuddy").map_err(|message| error("storage", message))
}

fn load_auth(app: &tauri::AppHandle, requested: Option<&str>) -> Result<Option<StoredAuth>, QueryError> {
    Ok(crate::storage::accounts::load::<StoredAuth>(app, "workbuddy", requested).map_err(|message| error("storage", message))?.map(|entry| entry.auth))
}

fn store_auth(app: &tauri::AppHandle, auth: &StoredAuth) -> Result<(), QueryError> {
    crate::storage::accounts::upsert(app, "workbuddy", account_id(auth), auth.clone()).map_err(|message| error("storage", message))
}

#[tauri::command]
pub async fn workbuddy_list_accounts(state: tauri::State<'_, WorkbuddyState>, app: tauri::AppHandle) -> Result<Vec<WorkbuddyAccount>, QueryError> {
    let _storage = state.storage.lock().await;
    Ok(stored_accounts(&app)?.into_iter().map(|entry| {
        let mut account = snapshot(&json!({}), &entry.auth);
        account.id = entry.id;
        account.fetched_at = 0;
        account
    }).collect())
}

#[tauri::command]
pub async fn workbuddy_cancel_login(state: tauri::State<'_, WorkbuddyState>, login_state: String) -> Result<Option<String>, QueryError> {
    // The flow lock also covers credential commit. If commit already won, tell the
    // frontend which account completed instead of reporting a misleading cancellation.
    let mut flows = state.flows.lock().await;
    flows.remove(&login_state);
    Ok(state.completed.lock().await.remove(&login_state))
}

/// Decodes the middle segment of a JWT; tolerant of missing base64 padding.
fn jwt_payload(token: &str) -> Option<Value> {
    let segment = token.split('.').nth(1)?;
    let decoded = data_url::IGNORED
        .decode(segment)
        .ok()?;
    serde_json::from_slice(&decoded).ok()
}

// data_url is not a dependency; use a tiny local base64url decoder instead.
mod data_url {
    pub struct Ignored;
    pub const IGNORED: Ignored = Ignored;
    impl Ignored {
        #[allow(non_snake_case)]
        pub fn decode(&self, input: &str) -> Result<Vec<u8>, ()> {
            fn value(byte: u8) -> Result<u32, ()> {
                match byte {
                    b'A'..=b'Z' => Ok((byte - b'A') as u32),
                    b'a'..=b'z' => Ok((byte - b'a' + 26) as u32),
                    b'0'..=b'9' => Ok((byte - b'0' + 52) as u32),
                    b'-' => Ok(62),
                    b'_' => Ok(63),
                    _ => Err(()),
                }
            }
            let bytes = input.trim_end_matches('=').as_bytes();
            let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
            for chunk in bytes.chunks(4) {
                if chunk.len() < 2 {
                    return Err(());
                }
                let mut buffer = (value(chunk[0])? << 18) | (value(chunk[1])? << 12);
                if chunk.len() > 2 {
                    buffer |= value(chunk[2])? << 6;
                }
                if chunk.len() > 3 {
                    buffer |= value(chunk[3])?;
                }
                out.push((buffer >> 16) as u8);
                if chunk.len() > 2 {
                    out.push((buffer >> 8) as u8);
                }
                if chunk.len() > 3 {
                    out.push(buffer as u8);
                }
            }
            Ok(out)
        }
    }
}

/// Reads the stable user identity out of the access token claims.
fn jwt_identity(token: &str) -> (String, String, String) {
    let payload = jwt_payload(token).unwrap_or(Value::Null);
    let text = |keys: &[&str]| -> String {
        keys.iter()
            .find_map(|key| payload[*key].as_str())
            .filter(|value| !value.is_empty())
            .unwrap_or_default()
            .to_owned()
    };
    (
        text(&["uid", "sub"]),
        text(&["nickname", "name", "preferred_username"]),
        text(&["enterpriseId", "enterprise_id"]),
    )
}

fn region_of(domain: &str) -> &'static str {
    if domain.to_lowercase().contains("workbuddy.ai") { "global" } else { "cn" }
}

fn billing_base(domain: &str) -> &'static str {
    if region_of(domain) == "global" { BILLING_GLOBAL } else { BILLING_CN }
}

fn number(value: &Value) -> u64 {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        .unwrap_or(0)
}

fn epoch_text(value: u64) -> String {
    let secs = if value > 10_000_000_000 { value / 1000 } else { value };
    match chrono::DateTime::from_timestamp(secs as i64, 0) {
        Some(moment) => moment.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M:%S").to_string(),
        None => String::new(),
    }
}

/// Normalizes the many expiry spellings the billing API may return.
/// Real responses carry the cycle window (`CycleEndTime`, matching the site's
/// 到期时间) plus a far-future deduction cutoff in millis (`DeductionEndTime`).
fn package_end_time(pkg: &Value) -> Option<String> {
    for key in ["CycleEndTime", "DeductionEndTime", "PackageEndTime", "EndTime", "ExpireTime", "PackageExpireTime", "ExpiredTime"] {
        let value = &pkg[key];
        let text = match value {
            Value::String(text) => text.clone(),
            _ if value.is_number() => epoch_text(number(value)),
            _ => continue,
        };
        let cleaned = text.trim().to_owned();
        if !cleaned.is_empty() && !cleaned.starts_with("0000") && !cleaned.starts_with("1970") {
            return Some(cleaned);
        }
    }
    None
}

/// Reads the decimal `*Precise` spelling of a capacity field, falling back to the rounded one.
/// The site's totals (e.g. 1,869.69) come from these; the rounded fields lose fractions per package.
fn precise(primary: &Value, fallback: &Value) -> f64 {
    let parsed = |value: &Value| match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    };
    parsed(primary).filter(|v| v.is_finite()).unwrap_or_else(|| parsed(fallback).filter(|v| v.is_finite()).unwrap_or(0.0))
}

/// Mirrors the billing client's cycle-first capacity extraction, precise decimals first.
fn package_remain_used(pkg: &Value) -> (f64, f64, f64) {
    let cycle_size = precise(&pkg["CycleCapacitySizePrecise"], &pkg["CycleCapacitySize"]);
    if cycle_size > 0.0 {
        let mut remain = precise(&pkg["CycleCapacityRemainPrecise"], &pkg["CycleCapacityRemain"]).min(cycle_size);
        let mut used = cycle_size - remain;
        let explicit = precise(&pkg["CycleCapacityUsedPrecise"], &pkg["CycleCapacityUsed"]);
        if explicit > used {
            used = explicit;
            if cycle_size >= used {
                remain = cycle_size - used;
            }
        }
        return (remain, used, cycle_size);
    }
    let cycle_remain = precise(&pkg["CycleCapacityRemainPrecise"], &pkg["CycleCapacityRemain"]);
    let cycle_used = precise(&pkg["CycleCapacityUsedPrecise"], &pkg["CycleCapacityUsed"]);
    if cycle_remain > 0.0 || cycle_used > 0.0 {
        let mut size = cycle_remain + cycle_used;
        let capacity = precise(&pkg["CapacitySizePrecise"], &pkg["CapacitySize"]);
        if capacity > size {
            size = capacity;
        }
        let used = (size - cycle_remain).max(cycle_used);
        return (cycle_remain, used, size);
    }
    let remain = precise(&pkg["CapacityRemainPrecise"], &pkg["CapacityRemain"]);
    let mut used = precise(&pkg["CapacityUsedPrecise"], &pkg["CapacityUsed"]);
    let mut size = precise(&pkg["CapacitySizePrecise"], &pkg["CapacitySize"]);
    if size == 0.0 {
        size = remain + used;
    }
    if used == 0.0 && size > remain {
        used = size - remain;
    }
    (remain, used, size)
}

fn parse_packages(data: &Value) -> Vec<Value> {
    // The billing API wraps Accounts differently across regions; take the first present.
    [
        &data["Response"]["Data"]["Accounts"],
        &data["Data"]["Accounts"],
        &data["Accounts"],
        &data["accounts"],
    ]
    .into_iter()
    .find_map(Value::as_array)
    .cloned()
    .unwrap_or_default()
}

fn snapshot(data: &Value, stored: &StoredAuth) -> WorkbuddyAccount {
    let mut total_remain = 0.0f64;
    let mut total_used = 0.0f64;
    let mut total_size = 0.0f64;
    let mut packages = Vec::new();
    for pkg in parse_packages(data) {
        let (remain, used, size) = package_remain_used(&pkg);
        total_remain += remain;
        total_used += used;
        total_size += size;
        packages.push(WorkbuddyPackage {
            name: pkg["PackageName"].as_str().or_else(|| pkg["packageName"].as_str()).unwrap_or("Credit package").to_owned(),
            remain,
            used,
            size,
            end_time: package_end_time(&pkg),
        });
    }
    // The API leaves some used fields at zero; derive them from capacity.
    if total_size > total_used {
        let derived = total_size - total_remain;
        if derived > total_used {
            total_used = derived.min(total_size);
        }
    }
    let dosage = precise(&data["Response"]["Data"]["TotalDosagePrecise"], &data["Response"]["Data"]["TotalDosage"])
        .max(precise(&data["Data"]["TotalDosagePrecise"], &data["Data"]["TotalDosage"]))
        .max(precise(&data["TotalDosagePrecise"], &data["TotalDosage"]));
    let (total_size, total_used) = if dosage > total_size {
        ((dosage), (dosage - total_remain).max(total_used))
    } else {
        (total_size, total_used)
    };
    WorkbuddyAccount {
        id: account_id(stored),
        provider_id: "workbuddy",
        source: "workbuddy-billing",
        uid: if stored.uid.is_empty() { None } else { Some(stored.uid.clone()) },
        nickname: if stored.nickname.is_empty() { None } else { Some(stored.nickname.clone()) },
        region: region_of(&stored.domain),
        fetched_at: now_secs(),
        total_remain,
        total_used,
        total_size,
        packages,
    }
}

async fn envelope(response: reqwest::Response) -> Result<Value, QueryError> {
    let value: Value = response
        .json()
        .await
        .map_err(|_| protocol_error())?;
    let code = value["code"].as_i64().unwrap_or(-1);
    if code != 0 {
        let message = value["msg"].as_str().unwrap_or_default().to_lowercase();
        if code == 12153 || message.contains("offline user session") {
            return Err(error(
                "not_logged_in",
                "WorkBuddy login expired. Reconnect the account from the account panel.",
            ));
        }
        return Err(error(
            "query_failed",
            "WorkBuddy rejected the request. Wait a moment and retry.",
        ));
    }
    Ok(value["data"].clone())
}

/// Exchanges the refresh token for a fresh access token via the CLI endpoint.
async fn refresh_access_token(
    state: &WorkbuddyState,
    stored: &mut StoredAuth,
) -> Result<(), QueryError> {
    let host = if region_of(&stored.domain) == "global" { BILLING_GLOBAL } else { AUTH_HOST };
    let response = state
        .http
        .post(format!("{host}/v2/plugin/auth/token/refresh"))
        .header("X-Refresh-Token", &stored.refresh_token)
        .header("X-Auth-Refresh-Source", "plugin")
        .header("X-Domain", &stored.domain)
        .header("Content-Type", "application/json")
        .body("{}")
        .send()
        .await
        .map_err(|_| error("network", "Could not reach WorkBuddy. Check your connection."))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(error(
            "not_logged_in",
            "WorkBuddy login expired. Reconnect the account from the account panel.",
        ));
    }
    let data = envelope(response).await?;
    let access = data["accessToken"]
        .as_str()
        .or_else(|| data["access_token"].as_str())
        .ok_or_else(protocol_error)?;
    stored.access_token = access.to_owned();
    if let Some(refresh) = data["refreshToken"]
        .as_str()
        .or_else(|| data["refresh_token"].as_str())
    {
        if !refresh.is_empty() {
            stored.refresh_token = refresh.to_owned();
        }
    }
    let expires_in = data["expiresIn"].as_u64().or_else(|| data["expires_in"].as_u64()).unwrap_or(30 * 24 * 3600);
    stored.expires_at = now_secs() + expires_in.min(90 * 24 * 3600);
    if let Some(domain) = data["domain"].as_str().filter(|value| !value.is_empty()) {
        stored.domain = domain.to_owned();
    }
    let (uid, nickname, enterprise_id) = jwt_identity(&stored.access_token);
    if !uid.is_empty() {
        stored.uid = uid;
    }
    if !nickname.is_empty() {
        stored.nickname = nickname;
    }
    if !enterprise_id.is_empty() {
        stored.enterprise_id = enterprise_id;
    }
    Ok(())
}

#[tauri::command]
pub async fn workbuddy_start_login(state: tauri::State<'_, WorkbuddyState>) -> Result<LoginStart, QueryError> {
    let response = state
        .http
        .post(format!("{AUTH_HOST}/v2/plugin/auth/state"))
        .query(&[("platform", "CLI")])
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("Origin", SITE_ORIGIN)
        .header("Referer", format!("{SITE_ORIGIN}/"))
        .body("{}")
        .send()
        .await
        .map_err(|_| error("network", "Could not reach the WorkBuddy login service. Check your connection."))?;
    let data = envelope(response).await?;
    let login_state = data["state"].as_str().ok_or_else(protocol_error)?.to_owned();
    let auth_url = data["authUrl"].as_str().ok_or_else(protocol_error)?.to_owned();
    let mut flows = state.flows.lock().await;
    if flows.len() >= 16 { flows.clear(); }
    flows.insert(login_state.clone());
    Ok(LoginStart { state: login_state, auth_url })
}

#[tauri::command]
pub async fn workbuddy_poll_login(
    state: tauri::State<'_, WorkbuddyState>,
    app: tauri::AppHandle,
    login_state: String,
) -> Result<PollOutcome, QueryError> {
    if login_state.is_empty() || login_state.len() > 256 || !login_state.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(protocol_error());
    }
    if !state.flows.lock().await.contains(&login_state) {
        return Ok(PollOutcome { status: "error", message: Some("Sign-in cancelled or expired.".into()), account_id: None });
    }
    let response = state
        .http
        .get(format!("{AUTH_HOST}/v2/plugin/auth/token"))
        .query(&[("state", login_state.as_str())])
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| error("network", "Could not reach the WorkBuddy login service. Check your connection."))?;
    let value: Value = response.json().await.map_err(|_| protocol_error())?;
    let code = value["code"].as_i64().unwrap_or(-1);
    if code == 0 {
        let data = &value["data"];
        let access = data["accessToken"].as_str().or_else(|| data["access_token"].as_str()).ok_or_else(protocol_error)?;
        let refresh = data["refreshToken"].as_str().or_else(|| data["refresh_token"].as_str()).unwrap_or_default();
        let expires_in = data["expiresIn"].as_u64().or_else(|| data["expires_in"].as_u64()).unwrap_or(0);
        let domain = data["domain"].as_str().unwrap_or("www.workbuddy.cn").to_owned();
        let (uid, nickname, enterprise_id) = jwt_identity(access);
        if uid.is_empty() { return Err(protocol_error()); }
        let mut flows = state.flows.lock().await;
        if !flows.remove(&login_state) {
            return Ok(PollOutcome { status: "error", message: Some("Sign-in cancelled.".into()), account_id: None });
        }
        let _storage = state.storage.lock().await;
        // Import an existing single-account login before adding the next account.
        stored_accounts(&app)?;
        let auth = StoredAuth {
                access_token: access.to_owned(),
                refresh_token: refresh.to_owned(),
                expires_at: now_secs() + expires_in,
                domain,
                uid,
                nickname,
                enterprise_id,
            };
        store_auth(&app, &auth)?;
        let id = account_id(&auth);
        let mut completed = state.completed.lock().await;
        if completed.len() >= 16 { completed.clear(); }
        completed.insert(login_state.clone(), id.clone());
        return Ok(PollOutcome { status: "success", message: None, account_id: Some(id) });
    }
    if code == 12153 {
        return Ok(PollOutcome { status: "error", message: Some("The sign-in session expired. Start again.".into()), account_id: None });
    }
    // 11217 and any other transient codes simply mean "keep waiting".
    Ok(PollOutcome { status: "pending", message: None, account_id: None })
}

#[tauri::command]
pub async fn workbuddy_query_quota(
    state: tauri::State<'_, WorkbuddyState>,
    app: tauri::AppHandle,
    account_id: Option<String>,
) -> Result<WorkbuddyAccount, QueryError> {
    let _guard = state.lock.lock().await;
    let mut stored = {
        let _storage = state.storage.lock().await;
        load_auth(&app, account_id.as_deref())?.ok_or_else(|| error("not_connected", "Connect a WorkBuddy account first."))?
    };
    if stored.access_token.is_empty() { return Err(error("not_connected", "Reconnect this WorkBuddy account.")); }
    {
        let mut last = state.last_query.lock().await;
        if let Some(previous) = *last {
            let remaining = MIN_QUERY_INTERVAL.saturating_sub(previous.elapsed());
            if !remaining.is_zero() { tokio::time::sleep(remaining).await; }
        }
        *last = Some(Instant::now());
    }
    if stored.expires_at <= now_secs() + TOKEN_REFRESH_MARGIN && !stored.refresh_token.is_empty() {
        refresh_access_token(&state, &mut stored).await?;
        let _storage = state.storage.lock().await;
        store_auth(&app, &stored)?;
    }
    let base = billing_base(&stored.domain);
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut request = state
        .http
        .post(format!("{base}/v2/billing/meter/get-user-resource"))
        .header("Authorization", format!("Bearer {}", stored.access_token))
        .header("X-Domain", &stored.domain)
        .header("Content-Type", "application/json");
    if !stored.uid.is_empty() {
        request = request.header("X-User-Id", &stored.uid);
    }
    if !stored.enterprise_id.is_empty() {
        request = request.header("X-Enterprise-Id", &stored.enterprise_id);
    }
    let response = request
        .body(
            json!({
                "PageNumber": 1,
                "PageSize": 100,
                "ProductCode": "p_tcaca",
                "Status": [0, 3],
                "PackageEndTimeRangeBegin": now,
                "PackageEndTimeRangeEnd": "2126-12-31 23:59:59",
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|_| error("network", "Could not reach WorkBuddy. Check your connection."))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(error(
            "not_logged_in",
            "WorkBuddy login expired. Reconnect the account from the account panel.",
        ));
    }
    let data = envelope(response).await?;
    Ok(snapshot(&data, &stored))
}

/// Used only after the activity engine validates the official destination.
pub(crate) async fn activity_headers(app: &tauri::AppHandle, id: &str, regions: &[String]) -> Result<reqwest::header::HeaderMap, String> {
    use tauri::Manager;
    let state = app.state::<WorkbuddyState>();
    let _guard = state.lock.lock().await;
    let _storage = state.storage.lock().await;
    let mut auth = load_auth(app, Some(id)).map_err(|e| e.message)?
        .ok_or("Connect this WorkBuddy account first.")?;
    // The check-in endpoints supplied and reviewed for this adapter are CN only.
    if region_of(&auth.domain) != "cn" || !regions.is_empty() && !regions.iter().any(|r| r == "cn") {
        return Err("This WorkBuddy activity does not support the account region.".into());
    }
    if auth.expires_at <= now_secs() + TOKEN_REFRESH_MARGIN && !auth.refresh_token.is_empty() {
        refresh_access_token(&state, &mut auth).await.map_err(|e| e.message)?;
        store_auth(app, &auth).map_err(|e| e.message)?;
    }
    if auth.access_token.is_empty() || auth.uid.is_empty() { return Err("Reconnect this WorkBuddy account.".into()); }
    let mut headers = reqwest::header::HeaderMap::new();
    for (name, value) in [("authorization", format!("Bearer {}", auth.access_token)), ("x-user-id", auth.uid),
        ("x-domain", auth.domain), ("user-agent", CLIENT_UA.into())] {
        headers.insert(reqwest::header::HeaderName::from_static(name), value.parse().map_err(|_| "Invalid saved activity authorization.")?);
    }
    Ok(headers)
}

#[cfg(test)]
#[path = "../../../tests/rust/workbuddy.rs"]
mod tests;
