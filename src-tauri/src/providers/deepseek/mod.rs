pub(crate) mod login;
mod wallet;

use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct DeepseekState(pub(super) Mutex<()>);
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Credential {
    api_key: String,
    label: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Balance {
    pub(super) currency: String,
    pub(super) total_balance: String,
    pub(super) granted_balance: String,
    pub(super) topped_up_balance: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) total_cost: Option<String>,
}
#[derive(Deserialize)]
struct Response {
    is_available: bool,
    balance_infos: Vec<Balance>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    id: String,
    provider_id: &'static str,
    source: &'static str,
    label: String,
    fetched_at: i64,
    is_available: bool,
    balances: Vec<Balance>,
    contact: Option<String>,
}
pub(super) fn platform_snapshot(
    id: String,
    label: String,
    contact: Option<String>,
    balances: Vec<Balance>,
    fetched_at: i64,
) -> Account {
    let is_available = balances.iter().any(|balance| {
        wallet::Decimal::parse(&balance.total_balance).is_some_and(|amount| amount.positive())
    });
    Account {
        id,
        label,
        contact,
        balances,
        fetched_at,
        is_available,
        provider_id: "deepseek",
        source: "deepseek-platform",
    }
}
#[derive(Serialize)]
pub struct Error {
    pub(super) message: String,
}
pub(super) fn error(message: &str) -> Error {
    Error {
        message: message.into(),
    }
}
pub(super) fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}
fn snapshot(id: String, label: String, response: Response, fetched_at: i64) -> Account {
    Account {
        id,
        label,
        provider_id: "deepseek",
        source: "deepseek-api",
        fetched_at,
        is_available: response.is_available,
        balances: response.balance_infos,
        contact: None,
    }
}
fn validate(response: Response) -> Result<Response, Error> {
    // Preserve decimal strings; never combine balances in different currencies.
    if response.balance_infos.is_empty()
        || response.balance_infos.iter().any(|balance| {
            !matches!(balance.currency.as_str(), "CNY" | "USD")
                || [
                    &balance.total_balance,
                    &balance.granted_balance,
                    &balance.topped_up_balance,
                ]
                .iter()
                .any(|amount| wallet::Decimal::parse(amount).is_none())
        })
    {
        return Err(error("DeepSeek returned an invalid balance response."));
    }
    Ok(response)
}
async fn query(api_key: &str) -> Result<Response, Error> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| error("Could not initialize the DeepSeek connection."))?;
    let response = client
        .get("https://api.deepseek.com/user/balance")
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|_| error("Could not reach DeepSeek. Check your connection and retry."))?;
    if !response.status().is_success() {
        return Err(error(match response.status().as_u16() {
            401 | 403 => "DeepSeek rejected this API key. Check the key and reconnect.",
            429 => "DeepSeek is limiting requests. Please retry later.",
            _ => "DeepSeek could not return the balance. Please retry later.",
        }));
    }
    validate(
        response
            .json()
            .await
            .map_err(|_| error("DeepSeek returned an unreadable balance response."))?,
    )
}
#[tauri::command]
pub async fn deepseek_connect(
    state: tauri::State<'_, DeepseekState>,
    app: tauri::AppHandle,
    api_key: String,
    label: String,
) -> Result<Account, Error> {
    let api_key = api_key.trim();
    let label = label.trim();
    if api_key.is_empty()
        || api_key.len() > 512
        || api_key.chars().any(char::is_whitespace)
        || api_key.chars().any(char::is_control)
    {
        return Err(error("Enter a valid DeepSeek API key."));
    }
    if label.is_empty() || label.chars().count() > 80 || label.chars().any(char::is_control) {
        return Err(error("Enter an account name of up to 80 characters."));
    }
    let response = query(api_key).await?;
    let _guard = state.0.lock().await;
    // A hash of the high-entropy key keeps reconnection stable without storing it in the ID.
    use sha2::{Digest, Sha256};
    let id = format!("deepseek-{:x}", Sha256::digest(api_key.as_bytes()));
    crate::storage::accounts::upsert(
        &app,
        "deepseek-api",
        id.clone(),
        Credential {
            api_key: api_key.into(),
            label: label.into(),
        },
    )
    .map_err(|message| error(&message))?;
    Ok(snapshot(id, label.into(), response, now_secs()))
}
#[tauri::command]
pub async fn deepseek_list_accounts(
    state: tauri::State<'_, DeepseekState>,
    app: tauri::AppHandle,
) -> Result<Vec<Account>, Error> {
    let _guard = state.0.lock().await;
    let mut accounts: Vec<Account> =
        crate::storage::accounts::read::<Credential>(&app, "deepseek-api")
            .map_err(|message| error(&message))?
            .into_iter()
            .map(|entry| {
                snapshot(
                    entry.id,
                    entry.auth.label,
                    Response {
                        is_available: false,
                        balance_infos: vec![],
                    },
                    0,
                )
            })
            .collect();
    accounts.extend(login::list_accounts(&app)?);
    Ok(accounts)
}
#[tauri::command]
pub async fn deepseek_query_balance(
    state: tauri::State<'_, DeepseekState>,
    app: tauri::AppHandle,
    account_id: String,
) -> Result<Account, Error> {
    if account_id.starts_with("deepseek-account-") {
        return login::query_account(&app, &account_id).await;
    }
    let entry = {
        let _guard = state.0.lock().await;
        crate::storage::accounts::load::<Credential>(&app, "deepseek-api", Some(&account_id))
            .map_err(|message| error(&message))?
            .ok_or_else(|| error("DeepSeek account not found. Reconnect it."))?
    };
    let response = query(&entry.auth.api_key).await?;
    Ok(snapshot(entry.id, entry.auth.label, response, now_secs()))
}
#[cfg(test)]
#[path = "../../../../tests/rust/deepseek.rs"]
mod tests;
