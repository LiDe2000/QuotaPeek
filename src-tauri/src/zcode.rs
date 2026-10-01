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
const AUTH_FILE: &str = "zcode-auth.json";
const DEVICE_FILE: &str = "zcode-device.json";
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
    /// flow id -> poll token; each flow authenticates its own polling.
    flows: Mutex<HashMap<String, String>>,
    http: reqwest::Client,
}
impl Default for ZcodeState {
    fn default() -> Self {
        Self { lock: Mutex::default(), last_query: Mutex::default(), flows: Mutex::default(), http: Self::client() }
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
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct StoredAuth {
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
    id: &'static str,
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

fn app_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, QueryError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| error("storage", "Could not locate the app data directory."))?;
    Ok(dir.join(name))
}

fn write_app_file(path: &Path, body: String, failure: &'static str) -> Result<(), QueryError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| error("storage", "Could not create the app data directory."))?;
    }
    std::fs::write(path, body).map_err(|_| error("storage", failure))
}

fn store_auth(app: &tauri::AppHandle, auth: &StoredAuth) -> Result<(), QueryError> {
    let body = serde_json::to_string_pretty(auth)
        .map_err(|_| error("storage", "Could not serialize the ZCode login."))?;
    write_app_file(&app_file(app, AUTH_FILE)?, body, "Could not save the ZCode login.")
}

fn load_auth(app: &tauri::AppHandle) -> Result<Option<StoredAuth>, QueryError> {
    let path = app_file(app, AUTH_FILE)?;
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes).map_err(|_| {
            error("storage", "Stored ZCode login is unreadable. Reconnect the account.")
        })?)),
        Err(_) => Ok(None),
    }
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
    let path = app_file(app, DEVICE_FILE)?;
    if let Ok(bytes) = std::fs::read(&path) {
        if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
            if let Some(mid) = value.get("deviceMid").and_then(Value::as_str) {
                if valid_device_id(mid) {
                    return Ok(mid.trim().to_owned());
                }
            }
        }
    }
    let mid = random_id();
    let body = serde_json::json!({ "deviceMid": mid }).to_string();
    write_app_file(&path, body, "Could not save the ZCode device identity.")?;
    Ok(mid)
}

fn device_id(app: &tauri::AppHandle, home: &Path) -> String {
    client_device_id(home).unwrap_or_else(|| own_device_id(app).unwrap_or_else(|_| random_id()))
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
    Some(StoredAuth {
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
        return Ok(PollOutcome { status: "error", message: Some("The sign-in session expired. Start again.".into()) });
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
        Err(_) => return Ok(PollOutcome { status: "pending", message: None }),
    };
    if !response.status().is_success() {
        return Ok(PollOutcome { status: "pending", message: None });
    }
    let value: Value = response.json().await.map_err(|_| protocol_error())?;
    let data = &value["data"];
    match data["status"].as_str().unwrap_or_default() {
        "failed" => {
            state.flows.lock().await.remove(&login_state);
            let message = data["message"].as_str().or_else(|| data["reason"].as_str()).unwrap_or_default();
            let message = if message.is_empty() { "Authorization was denied or failed." } else { message };
            Ok(PollOutcome { status: "error", message: Some(message.to_owned()) })
        }
        "ready" => {
            state.flows.lock().await.remove(&login_state);
            // The site comes from the stored flow, not the payload: the payload nests the
            // provider token under a key named after the site.
            let Some(auth) = credential_from_poll(data, site) else {
                return Ok(PollOutcome { status: "error", message: Some("No credentials came back. Start again.".into()) });
            };
            store_auth(&app, &auth)?;
            Ok(PollOutcome { status: "success", message: None })
        }
        _ => Ok(PollOutcome { status: "pending", message: None }),
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
        id: "zcode-oauth",
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
pub async fn zcode_query_quota(state: tauri::State<'_, ZcodeState>, app: tauri::AppHandle) -> Result<ZcodeAccount, QueryError> {
    let _guard = state
        .lock
        .try_lock()
        .map_err(|_| error("busy", "A ZCode query is already running."))?;
    {
        let mut last = state.last_query.lock().await;
        if let Some(previous) = *last {
            if previous.elapsed() < MIN_QUERY_INTERVAL {
                return Err(error("busy", "Quota was just refreshed. Wait a few seconds between queries."));
            }
        }
        *last = Some(Instant::now());
    }
    let auth = load_auth(&app)?.ok_or_else(not_connected)?;
    if auth.jwt().is_empty() {
        return Err(not_connected());
    }
    let device = match home_dir(&app) {
        Some(home) => device_id(&app, &home),
        None => own_device_id(&app).unwrap_or_else(|_| random_id()),
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
mod tests {
    use super::*;
    use serde_json::json;

    fn auth_for(provider: &str) -> StoredAuth {
        StoredAuth {
            zcode_jwt_token: "jwt".into(),
            access_token: "access".into(),
            provider: provider.into(),
            label: "LiDe".into(),
            site: String::new(),
            email: String::new(),
        }
    }

    fn balance_payload() -> Value {
        json!({"code": 0, "msg": "", "data": {
            "server_time": 1790823847_u64,
            "plans": [{
                "plan_id": "zcode-v3-start-plan-trust-1001",
                "name": "ZCode Trust Build",
                "description": "ZCode Global Build",
                "status": "active",
                "starts_at": 1790822627_u64,
                "ends_at": 1790870400_u64,
                "entitlements": [{
                    "entitlement_id": "zcode-v3-start-plan-trust-1001",
                    "show_name": "GLM-5.3-Flash",
                    "unit_type": "token",
                    "period": "one_time",
                    "grant_units": 100000000_u64
                }]
            }],
            "balances": [{
                "bucket_id": "bucket_2105488821852463104",
                "entitlement_id": "zcode-v3-start-plan-trust-1001",
                "show_name": "GLM-5.3-Flash",
                "unit_type": "token",
                "total_units": 100000000_u64,
                "used_units": 25000000_u64,
                "remaining_units": 75000000_u64,
                "available_units": 75000000_u64,
                "period_end": 1790870400_u64,
                "expires_at": 1790870400_u64
            }]
        }})
    }

    #[test]
    fn sites_map_to_their_own_regions() {
        assert_eq!(region_of("bigmodel"), "cn");
        assert_eq!(region_of("zhipu"), "cn");
        assert_eq!(region_of("BIGMODEL"), "cn");
        assert_eq!(region_of("zai"), "global");
        assert_eq!(region_of(""), "global");
    }

    #[test]
    fn the_device_id_must_look_like_a_uuid() {
        assert!(valid_device_id("117917d4-7ee3-4ed8-8a44-1367f0a2ddc4"));
        assert!(!valid_device_id("nope"));
        assert!(!valid_device_id(""));
        assert!(!valid_device_id("117917d4-7ee3-4ed8-8a44-1367f0a2ddc4-extra"));
    }

    #[test]
    fn the_client_device_id_is_read_but_a_bad_one_is_ignored() {
        let home = std::env::temp_dir().join(format!("quotapeek-zcode-home-{}", std::process::id()));
        let dir = home.join(".zcode/v2");
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(client_device_id(&home), None);
        std::fs::write(dir.join("telemetry-state.json"), r#"{"deviceMid":"117917d4-7ee3-4ed8-8a44-1367f0a2ddc4"}"#).unwrap();
        assert_eq!(client_device_id(&home).as_deref(), Some("117917d4-7ee3-4ed8-8a44-1367f0a2ddc4"));
        std::fs::write(dir.join("telemetry-state.json"), r#"{"deviceMid":"not-a-uuid"}"#).unwrap();
        assert_eq!(client_device_id(&home), None);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn the_poll_token_is_64_hex_characters() {
        let token = random_poll_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(token, random_poll_token());
    }

    #[test]
    fn a_ready_poll_yields_both_credentials_and_a_display_name() {
        let data = json!({
            "status": "ready",
            "token": "the-zcode-jwt",
            "bigmodel": {"access_token": "the-provider-token", "refresh_token": "r"},
            "user": {"user_id": "18311784773455644", "name": "LiDe", "email": ""}
        });
        let auth = credential_from_poll(&data, SITE_BIGMODEL).unwrap();
        assert_eq!(auth.jwt(), "the-zcode-jwt");
        assert_eq!(auth.access_token, "the-provider-token");
        assert_eq!(auth.site(), SITE_BIGMODEL);
        assert_eq!(auth.who(), "LiDe");
    }

    #[test]
    fn a_zai_poll_reads_its_own_nested_token_and_falls_back_to_the_user_id() {
        let data = json!({
            "status": "ready",
            "token": "jwt",
            "zai": {"accessToken": "camel-case-token"},
            "user": {"user_id": "42"}
        });
        let auth = credential_from_poll(&data, SITE_ZAI).unwrap();
        assert_eq!(auth.access_token, "camel-case-token");
        assert_eq!(auth.site(), SITE_ZAI);
        assert_eq!(auth.who(), "42");
    }

    #[test]
    fn a_poll_without_the_jwt_is_not_a_credential() {
        assert!(credential_from_poll(&json!({"status": "ready", "user": {"user_id": "1"}}), SITE_ZAI).is_none());
        assert!(credential_from_poll(&json!({"status": "ready", "token": "   "}), SITE_ZAI).is_none());
    }

    #[test]
    fn logins_written_before_the_billing_rework_still_work() {
        // Earlier builds stored the poll's `token` under `accessToken` and the site under `site`.
        let legacy: StoredAuth = serde_json::from_str(r#"{"accessToken":"old-jwt","email":"a@b.c","site":"bigmodel"}"#).unwrap();
        assert_eq!(legacy.jwt(), "old-jwt");
        assert_eq!(legacy.site(), SITE_BIGMODEL);
        assert_eq!(legacy.who(), "a@b.c");
        // A current file always prefers its own fields.
        let current = auth_for(SITE_ZAI);
        assert_eq!(current.jwt(), "jwt");
        assert_eq!(current.site(), SITE_ZAI);
        assert_eq!(current.who(), "LiDe");
    }

    #[test]
    fn a_stored_login_round_trips_through_json() {
        let body = serde_json::to_string(&auth_for(SITE_BIGMODEL)).unwrap();
        let back: StoredAuth = serde_json::from_str(&body).unwrap();
        assert_eq!(back.jwt(), "jwt");
        assert_eq!(back.site(), SITE_BIGMODEL);
        assert_eq!(back.who(), "LiDe");
    }

    #[test]
    fn balances_become_one_row_each_with_a_derived_percentage() {
        let account = parse_account(&balance_payload(), &auth_for(SITE_BIGMODEL)).unwrap();
        assert_eq!(account.id, "zcode-oauth");
        assert_eq!(account.plan_name.as_deref(), Some("ZCode Trust Build"));
        assert_eq!(account.plan_description.as_deref(), Some("ZCode Global Build"));
        assert_eq!(account.region, "cn");
        assert_eq!(account.email.as_deref(), Some("LiDe"));
        assert_eq!(account.windows.len(), 1);
        let window = &account.windows[0];
        assert_eq!(window.label, "GLM-5.3-Flash");
        assert_eq!(window.unit, "token");
        assert_eq!(window.used_percent, 25.0);
        assert_eq!(window.used, Some(25_000_000.0));
        assert_eq!(window.remain, Some(75_000_000.0));
        assert_eq!(window.total, Some(100_000_000.0));
        assert_eq!(window.resets_at, Some(1_790_870_400_000));
        assert_eq!(window.key, "bucket_2105488821852463104");
        assert!(window.one_time);
    }

    #[test]
    fn remaining_falls_back_to_available_and_percentages_stay_clamped() {
        let payload = json!({"code": 0, "data": {"plans": [], "balances": [
            {"show_name": "A", "total_units": 0, "used_units": 5, "available_units": 7},
            {"show_name": "B", "total_units": 10, "used_units": 40}
        ]}});
        let account = parse_account(&payload, &auth_for(SITE_ZAI)).unwrap();
        assert_eq!(account.region, "global");
        assert_eq!(account.plan_name, None);
        assert_eq!(account.windows[0].used_percent, 0.0);
        assert_eq!(account.windows[0].remain, Some(7.0));
        // An unlabelled bucket still gets a stable key of its own.
        assert_eq!(account.windows[0].key, "bucket-0");
        assert_eq!(account.windows[1].used_percent, 100.0);
        assert_eq!(account.windows[1].remain, None);
        assert!(!account.windows[1].one_time);
    }

    #[test]
    fn a_nonzero_body_code_surfaces_the_server_message() {
        let failure = parse_account(&json!({"code": 3001, "msg": "invalid_flow"}), &auth_for(SITE_ZAI)).unwrap_err();
        assert_eq!(failure.code, "query_failed");
        assert_eq!(failure.message, "invalid_flow");
        // An empty message still gets a readable fallback rather than an empty card.
        let blank = parse_account(&json!({"code": 1, "msg": "  "}), &auth_for(SITE_ZAI)).unwrap_err();
        assert_eq!(blank.message, "ZCode rejected the quota request.");
    }

    #[test]
    fn a_login_without_a_display_name_carries_no_identity() {
        let mut auth = auth_for(SITE_ZAI);
        auth.label = "  ".into();
        let account = parse_account(&balance_payload(), &auth).unwrap();
        assert_eq!(account.email, None);
    }
}
