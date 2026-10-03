//! ZCode (Z.ai / BigModel GLM coding plan) quota.
//!
//! Sign-in follows the official CLI OAuth: `oauth/cli/init` hands out an authorize
//! URL, the user approves it in a browser, and `oauth/cli/poll/{flow_id}` is queried
//! until the flow turns ready. The poll returns two credentials; the one that matters
//! here is `data.token`, the ZCode JWT that the billing route accepts.
//!
//! Quota then comes from one read-only GET on zcode.z.ai. Both account systems (Z.ai
//! global, BigModel/智谱 China) share that route, so the site only decides which page
//! the browser opens.
//!
//! Safety rails, because this route is undocumented and rate sensitive:
//! - read-only GETs only; no plan claims, no activation, no API-key creation
//! - the request carries the client's own fingerprint headers, including the device
//!   identity the ZCode client already uses on this machine, so it does not look like
//!   an unfamiliar device
//! - queries are user-triggered only, spaced by MIN_QUERY_INTERVAL, never retried
//!   in a loop; a failure is reported once and left for the user

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tokio::sync::Mutex;

const OAUTH_BASE: &str = "https://zcode.z.ai/api/v1";
const BILLING_BALANCE_URL: &str = "https://zcode.z.ai/api/v1/zcode-plan/billing/balance";
/// ZCode binds either the global Z.ai account or a BigModel (Zhipu, CN) one. The
/// OAuth `provider` picks the sign-in page.
const SITE_ZAI: &str = "zai";
const SITE_BIGMODEL: &str = "bigmodel";
/// Matches the desktop client's own billing fingerprint.
const APP_VERSION: &str = "3.14.4";
const ORIGIN: &str = "https://zcode.z.ai";
/// Manual refresh only; a burst of billing calls is the fastest way to get flagged.
/// The route answers 429 to a handful of rapid calls.
const MIN_QUERY_INTERVAL: Duration = Duration::from_secs(10);
/// Flows expire server side; clearing before an insert keeps the map bounded.
const MAX_PENDING_FLOWS: usize = 16;

fn normalize_site(site: &str) -> &'static str {
    if site.eq_ignore_ascii_case(SITE_BIGMODEL) || site.eq_ignore_ascii_case("zhipu") {
        SITE_BIGMODEL
    } else {
        SITE_ZAI
    }
}
fn region_of(provider: &str) -> &'static str {
    if normalize_site(provider) == SITE_BIGMODEL {
        "cn"
    } else {
        "global"
    }
}

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
    error("protocol", "ZCode returned an unsupported response. Retry later.")
}
fn not_connected() -> QueryError {
    error("not_connected", "Connect a ZCode account from the account panel first.")
}
fn expired_login() -> QueryError {
    error("not_logged_in", "ZCode sign-in expired. Reconnect the account from the account panel.")
}

pub struct ZcodeState {
    /// Serializes quota queries so overlapping refreshes cannot race.
    lock: Mutex<()>,
    last_query: Mutex<Option<Instant>>,
    storage: Mutex<()>,
    completed: Mutex<HashMap<String, String>>,
    /// flow id -> poll token; each flow authenticates its own polling.
    flows: Mutex<HashMap<String, String>>,
    http: reqwest::Client,
}
impl Default for ZcodeState {
    fn default() -> Self {
        Self { lock: Mutex::default(), last_query: Mutex::default(), storage: Mutex::default(), completed: Mutex::default(), flows: Mutex::default(), http: Self::client() }
    }
}
impl ZcodeState {
    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .user_agent(format!("ZCode/{APP_VERSION}"))
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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct StoredAuth {
    #[serde(default)]
    identity: String,
    /// `data.token` from the poll — the credential the billing route accepts.
    #[serde(default)]
    zcode_jwt_token: String,
    /// The provider `access_token`, which only speaks to the sign-in endpoints.
    #[serde(default)]
    access_token: String,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    label: String,
    /// Written by earlier builds, which kept the poll's `token` under `accessToken`
    /// and the sign-in site under `site`. Both are read back so an existing login keeps
    /// working without a fresh round trip.
    #[serde(default)]
    site: String,
    #[serde(default)]
    email: String,
}
impl StoredAuth {
    fn jwt(&self) -> &str {
        if self.zcode_jwt_token.is_empty() { &self.access_token } else { &self.zcode_jwt_token }
    }
    fn site(&self) -> &str {
        if self.provider.is_empty() { &self.site } else { &self.provider }
    }
    fn who(&self) -> &str {
        if self.label.is_empty() { &self.email } else { &self.label }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZcodeWindow {
    key: String,
    /// The model or entitlement the bucket meters, e.g. "GLM-5.3-Flash".
    label: String,
    /// "token" for the coding-plan buckets.
    unit: String,
    used_percent: f64,
    used: Option<f64>,
    remain: Option<f64>,
    total: Option<f64>,
    /// Milliseconds; the card renders it in local time.
    resets_at: Option<u64>,
    /// A one-time grant does not reset, it expires — the card says so.
    one_time: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZcodeAccount {
    id: String,
    provider_id: &'static str,
    source: &'static str,
    /// The display name the poll carried; there is often no email.
    email: Option<String>,
    plan_name: Option<String>,
    plan_description: Option<String>,
    /// "cn" for a BigModel account, "global" for Z.ai.
    region: &'static str,
    fetched_at: u64,
    windows: Vec<ZcodeWindow>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

/// `16 * parts` hex characters. `RandomState` is seeded from the OS, which is enough
/// entropy for a poll token, a device id or a per-request correlation id without pulling
/// in an RNG crate.
fn random_hex(parts: usize) -> String {
    use std::hash::{BuildHasher, Hash, Hasher};
    let mut hex = String::with_capacity(parts * 16);
    for round in 0..parts {
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        round.hash(&mut hasher);
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos().hash(&mut hasher);
        hex.push_str(&format!("{:016x}", hasher.finish()));
    }
    hex
}

/// 32 hex characters shaped like a UUID, used for the device id and request id.
fn random_id() -> String {
    let hex = random_hex(2);
    format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

/// The OAuth poll expects a 64 hex character bearer token of its own.
fn random_poll_token() -> String {
    random_hex(4)
}

fn account_id(auth: &StoredAuth) -> String {
    let identity = if auth.identity.is_empty() { auth.who() } else { &auth.identity };
    crate::storage::accounts::key("zcode", &format!("{}:{}", normalize_site(auth.site()), identity))
}

fn stored_accounts(app: &tauri::AppHandle) -> Result<Vec<crate::storage::accounts::Entry<StoredAuth>>, QueryError> {
    crate::storage::accounts::read(app, "zcode").map_err(|message| error("storage", message))
}

fn store_auth(app: &tauri::AppHandle, auth: &StoredAuth) -> Result<(), QueryError> {
    crate::storage::accounts::upsert(app, "zcode", account_id(auth), auth.clone()).map_err(|message| error("storage", message))
}

fn load_auth(app: &tauri::AppHandle, requested: Option<&str>) -> Result<Option<StoredAuth>, QueryError> {
    Ok(crate::storage::accounts::load::<StoredAuth>(app, "zcode", requested).map_err(|message| error("storage", message))?.map(|entry| entry.auth))
}

#[tauri::command]
pub async fn zcode_list_accounts(state: tauri::State<'_, ZcodeState>, app: tauri::AppHandle) -> Result<Vec<ZcodeAccount>, QueryError> {
    let _storage = state.storage.lock().await;
    stored_accounts(&app)?.into_iter().map(|entry| {
        let mut account = parse_account(&serde_json::json!({"code": 0, "data": {}}), &entry.auth)?;
        account.id = entry.id;
        account.fetched_at = 0;
        Ok(account)
    }).collect()
}

#[tauri::command]
pub async fn zcode_cancel_login(state: tauri::State<'_, ZcodeState>, login_state: String) -> Result<Option<String>, QueryError> {
    // The flow lock also covers credential commit. If commit already won, tell the
    // frontend which account completed instead of reporting a misleading cancellation.
    let mut flows = state.flows.lock().await;
    flows.remove(&login_state);
    Ok(state.completed.lock().await.remove(&login_state))
}

fn valid_device_id(candidate: &str) -> bool {
    let trimmed = candidate.trim();
    trimmed.len() == 36 && trimmed.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// The official client keeps a stable device id in `telemetry-state.json`. Reusing it
/// means ZCode sees the same device it already knows rather than a new one.
fn client_device_id(home: &Path) -> Option<String> {
    let text = std::fs::read_to_string(home.join(".zcode/v2/telemetry-state.json")).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let mid = value.get("deviceMid")?.as_str()?;
    valid_device_id(mid).then(|| mid.trim().to_owned())
}

/// Falls back to one id of our own, minted once and then reused for the life of the app.
fn own_device_id(app: &tauri::AppHandle) -> Result<String, QueryError> {
    let mid = app.state::<crate::storage::Database>().setting_or_insert("device.zcode", &random_id())
        .map_err(|message| error("storage", message))?;
    if !valid_device_id(&mid) { return Err(error("storage", "Saved ZCode device identity is unreadable.")); }
    Ok(mid)
}

fn device_id(app: &tauri::AppHandle, home: &Path) -> Result<String, QueryError> {
    match client_device_id(home) { Some(mid) => Ok(mid), None => own_device_id(app) }
}

fn home_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().home_dir().ok()
}

/// Reads the credential the poll hands back. The JWT is required; the provider token
/// and display name are best effort, so a shape change there cannot break sign-in.
fn credential_from_poll(data: &Value, site: &str) -> Option<StoredAuth> {
    let jwt = data["token"].as_str().map(str::trim).filter(|value| !value.is_empty())?;
    let nested = if site == SITE_BIGMODEL { &data[SITE_BIGMODEL] } else { &data[SITE_ZAI] };
    let access_token = nested["access_token"]
        .as_str()
        .or_else(|| nested["accessToken"].as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let user = &data["user"];
    let label = ["name", "email", "user_id"]
        .into_iter()
        .find_map(|key| user[key].as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let identity = ["user_id", "id", "email"].into_iter()
        .find_map(|key| user[key].as_str().filter(|value| !value.trim().is_empty()))
        .map(str::to_owned).unwrap_or_else(random_id);
    Some(StoredAuth {
        identity,
        zcode_jwt_token: jwt.to_owned(),
        access_token: access_token.to_owned(),
        provider: site.to_owned(),
        label: label.to_owned(),
        site: String::new(),
        email: String::new(),
    })
}

#[tauri::command]
pub async fn zcode_start_login(state: tauri::State<'_, ZcodeState>, site: String) -> Result<LoginStart, QueryError> {
    let site = normalize_site(&site);
    let poll_token = random_poll_token();
    let response = state
        .http
        .post(format!("{OAUTH_BASE}/oauth/cli/init"))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {poll_token}"))
        .body(format!(r#"{{"provider":"{site}"}}"#))
        .send()
        .await
        .map_err(|_| error("network", "Could not reach the ZCode login service. Check your connection."))?;
    let value: Value = response.json().await.map_err(|_| protocol_error())?;
    let data = &value["data"];
    if value["code"].as_i64().unwrap_or(-1) != 0 {
        return Err(error("login_failed", "ZCode could not start the sign-in. Try again."));
    }
    let flow = data["flow_id"].as_str().or_else(|| data["flowId"].as_str()).ok_or_else(protocol_error)?;
    let auth_url = data["authorize_url"].as_str().or_else(|| data["authorizeUrl"].as_str()).ok_or_else(protocol_error)?;
    if flow.is_empty() || flow.len() > 128 || auth_url.is_empty() {
        return Err(protocol_error());
    }
    // Flows expire server side; keep the map from growing without bound. Clear before
    // inserting so the new flow can never evict itself.
    let mut flows = state.flows.lock().await;
    if flows.len() >= MAX_PENDING_FLOWS {
        flows.clear();
    }
    // The site travels with the flow so the poll knows which nested credential to read.
    flows.insert(flow.to_owned(), format!("{poll_token}|{site}"));
    drop(flows);
    Ok(LoginStart { state: flow.to_owned(), auth_url: auth_url.to_owned() })
}

#[tauri::command]
pub async fn zcode_poll_login(
    state: tauri::State<'_, ZcodeState>,
    app: tauri::AppHandle,
    login_state: String,
) -> Result<PollOutcome, QueryError> {
    let flow_entry = {
        let flows = state.flows.lock().await;
        flows.get(&login_state).cloned()
    };
    let Some(flow_entry) = flow_entry else {
        return Ok(PollOutcome { status: "error", message: Some("The sign-in session expired. Start again.".into()), account_id: None });
    };
    // "poll_token|site" as stored by zcode_start_login.
    let (poll_token, site) = flow_entry.split_once('|').unwrap_or((flow_entry.as_str(), SITE_ZAI));
    let site = normalize_site(site);
    if login_state.is_empty() || login_state.len() > 128 || !login_state.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(protocol_error());
    }
    let response = match state
        .http
        .get(format!("{OAUTH_BASE}/oauth/cli/poll/{login_state}"))
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {poll_token}"))
        .send()
        .await
    {
        Ok(response) => response,
        // A blip is still "keep waiting".
        Err(_) => return Ok(PollOutcome { status: "pending", message: None, account_id: None }),
    };
    if !response.status().is_success() {
        return Ok(PollOutcome { status: "pending", message: None, account_id: None });
    }
    let value: Value = response.json().await.map_err(|_| protocol_error())?;
    let data = &value["data"];
    match data["status"].as_str().unwrap_or_default() {
        "failed" => {
            state.flows.lock().await.remove(&login_state);
            let message = data["message"].as_str().or_else(|| data["reason"].as_str()).unwrap_or_default();
            let message = if message.is_empty() { "Authorization was denied or failed." } else { message };
            Ok(PollOutcome { status: "error", message: Some(message.to_owned()), account_id: None })
        }
        "ready" => {
            let mut flows = state.flows.lock().await;
            if flows.remove(&login_state).is_none() {
                return Ok(PollOutcome { status: "error", message: Some("Sign-in cancelled.".into()), account_id: None });
            }
            // The site comes from the stored flow, not the payload: the payload nests the
            // provider token under a key named after the site.
            let Some(auth) = credential_from_poll(data, site) else {
                return Ok(PollOutcome { status: "error", message: Some("No credentials came back. Start again.".into()), account_id: None });
            };
            let _storage = state.storage.lock().await;
            stored_accounts(&app)?;
            store_auth(&app, &auth)?;
            let id = account_id(&auth);
            let mut completed = state.completed.lock().await;
            if completed.len() >= 16 { completed.clear(); }
            completed.insert(login_state.clone(), id.clone());
            Ok(PollOutcome { status: "success", message: None, account_id: Some(id) })
        }
        _ => Ok(PollOutcome { status: "pending", message: None, account_id: None }),
    }
}

fn number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(value) => value.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
    .filter(|value| value.is_finite())
}

/// Unix seconds to milliseconds; absent and sentinel-zero stamps become `None`.
fn milliseconds(seconds: Option<u64>) -> Option<u64> {
    seconds.filter(|value| *value > 0).map(|value| value.saturating_mul(1000))
}

/// Sorts the billing payload into the card's rows: one row per balance bucket, plus the
/// active plan's name. Unknown shapes are labelled, never guessed.
fn parse_account(payload: &Value, auth: &StoredAuth) -> Result<ZcodeAccount, QueryError> {
    if payload.get("code").and_then(Value::as_i64) != Some(0) {
        let message = payload
            .get("msg")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("ZCode rejected the quota request.");
        return Err(error("query_failed", message));
    }
    let data = &payload["data"];
    let plans = data["plans"].as_array().cloned().unwrap_or_default();
    let plan = plans.iter().find(|plan| plan["status"].as_str() == Some("active")).or_else(|| plans.first());
    // A one-time grant expires rather than resets, so collect which entitlements those are.
    let mut one_time: HashSet<&str> = HashSet::new();
    for entitlement in plans.iter().flat_map(|plan| plan["entitlements"].as_array().map(Vec::as_slice).unwrap_or_default()) {
        if entitlement["period"].as_str() == Some("one_time") {
            if let Some(id) = entitlement["entitlement_id"].as_str() {
                one_time.insert(id);
            }
        }
    }
    let windows = data["balances"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(index, item)| {
                    let total = number(&item["total_units"]);
                    let used = number(&item["used_units"]);
                    let remain = number(&item["remaining_units"]).or_else(|| number(&item["available_units"]));
                    let used_percent = match (used, total) {
                        (Some(used), Some(total)) if total > 0.0 => (used / total * 100.0).clamp(0.0, 100.0),
                        _ => 0.0,
                    };
                    let key = item["bucket_id"]
                        .as_str()
                        .or_else(|| item["entitlement_id"].as_str())
                        .map(str::to_owned)
                        .unwrap_or_else(|| format!("bucket-{index}"));
                    ZcodeWindow {
                        label: item["show_name"]
                            .as_str()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .unwrap_or("Quota")
                            .to_owned(),
                        unit: item["unit_type"].as_str().unwrap_or("token").to_owned(),
                        used_percent,
                        used,
                        remain,
                        total,
                        resets_at: milliseconds(
                            item["period_end"].as_u64().or_else(|| item["expires_at"].as_u64()),
                        ),
                        one_time: item["entitlement_id"]
                            .as_str()
                            .is_some_and(|id| one_time.contains(id)),
                        key,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    let who = auth.who().trim();
    Ok(ZcodeAccount {
        id: account_id(auth),
        provider_id: "zcode",
        source: "zcode-billing",
        email: (!who.is_empty()).then(|| who.to_owned()),
        plan_name: plan.and_then(|plan| plan["name"].as_str()).map(str::to_owned),
        plan_description: plan
            .and_then(|plan| plan["description"].as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        region: region_of(auth.site()),
        fetched_at: now_secs(),
        windows,
    })
}

#[tauri::command]
pub async fn zcode_query_quota(state: tauri::State<'_, ZcodeState>, app: tauri::AppHandle, account_id: Option<String>) -> Result<ZcodeAccount, QueryError> {
    let _guard = state.lock.lock().await;
    let auth = {
        let _storage = state.storage.lock().await;
        load_auth(&app, account_id.as_deref())?.ok_or_else(not_connected)?
    };
    if auth.jwt().is_empty() { return Err(not_connected()); }
    {
        let mut last = state.last_query.lock().await;
        if let Some(previous) = *last {
            let remaining = MIN_QUERY_INTERVAL.saturating_sub(previous.elapsed());
            if !remaining.is_zero() { tokio::time::sleep(remaining).await; }
        }
        *last = Some(Instant::now());
    }
    let device = match home_dir(&app) {
        Some(home) => device_id(&app, &home)?,
        None => own_device_id(&app)?,
    };
    let response = state
        .http
        .get(format!("{BILLING_BALANCE_URL}?app_version={APP_VERSION}"))
        .bearer_auth(auth.jwt())
        .header("Accept", "application/json")
        .header("http-referer", ORIGIN)
        .header("x-zcode-app-version", APP_VERSION)
        .header("x-title", "Z Code@electron")
        .header("x-platform", format!("{}-{}", platform_name(), arch_name()))
        .header("x-release-channel", "production")
        .header("x-client-language", "en-US")
        .header("x-client-timezone", "UTC")
        .header("x-os-category", os_category())
        .header("x-os-version", os_version())
        .header("x-device-mid", device)
        .header("x-request-id", random_id())
        .send()
        .await
        .map_err(|_| error("network", "Could not reach ZCode. Check your connection."))?;
    let status = response.status().as_u16();
    if status == 401 || status == 403 {
        return Err(expired_login());
    }
    if status == 429 {
        return Err(error("rate_limited", "ZCode is rate limiting requests. Wait a minute before refreshing."));
    }
    if !response.status().is_success() {
        return Err(error("query_failed", "ZCode rejected the quota request. Wait a moment and retry."));
    }
    let payload: Value = response.json().await.map_err(|_| protocol_error())?;
    parse_account(&payload, &auth)
}

fn platform_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}
fn arch_name() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        "x86" => "ia32",
        other => other,
    }
}
fn os_category() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        other => other,
    }
}
/// The client sends its OS build here. The exact string is cosmetic to the route, so an
/// environment-derived value is preferred over a guessed one.
fn os_version() -> String {
    std::env::var("OS").ok().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| std::env::consts::OS.to_owned())
}

#[cfg(test)]
#[path = "../../../tests/rust/zcode.rs"]
mod tests;
