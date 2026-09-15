use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, ChildStdout, Command},
    sync::Mutex,
};

#[derive(Default)]
pub struct QueryState(Mutex<()>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryError {
    code: &'static str,
    message: &'static str,
}
fn error(code: &'static str, message: &'static str) -> QueryError {
    QueryError { code, message }
}
fn protocol_error() -> QueryError {
    error(
        "protocol",
        "Codex returned an unsupported response. Update Codex and retry.",
    )
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    used_percent: f64,
    window_duration_mins: Option<i64>,
    resets_at: Option<i64>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credits {
    has_credits: bool,
    unlimited: bool,
    balance: Option<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendLimit {
    limit: String,
    used: String,
    remaining_percent: f64,
    resets_at: i64,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    limit_id: Option<String>,
    limit_name: Option<String>,
    primary: Option<Window>,
    secondary: Option<Window>,
    credits: Option<Credits>,
    plan_type: Option<String>,
    individual_limit: Option<SpendLimit>,
    spend_control_reached: Option<bool>,
    rate_limit_reached_type: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LimitsResponse {
    account_id: Option<String>,
    rate_limits: Bucket,
    rate_limits_by_limit_id: Option<BTreeMap<String, Bucket>>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccount {
    id: &'static str,
    provider_id: &'static str,
    source: &'static str,
    account_id: Option<String>,
    email: Option<String>,
    plan_type: Option<String>,
    fetched_at: u64,
    rate_limits: BTreeMap<String, Bucket>,
}

fn identity(value: &Value) -> Result<(Option<String>, Option<String>), QueryError> {
    let account = &value["account"];
    if account.is_null() {
        return Err(error(
            "not_logged_in",
            "Sign in to Codex with your ChatGPT account, then retry.",
        ));
    }
    if account["type"] != "chatgpt" {
        return Err(error("unsupported_auth", "Subscription quota requires a ChatGPT login in Codex. API key accounts are not supported."));
    }
    Ok((
        account["email"].as_str().map(str::to_owned),
        account["planType"].as_str().map(str::to_owned),
    ))
}

fn snapshot(account: &Value, limits: Value) -> Result<CodexAccount, QueryError> {
    let (email, plan_type) = identity(account)?;
    let response: LimitsResponse = serde_json::from_value(limits).map_err(|_| protocol_error())?;
    let mut buckets = response.rate_limits_by_limit_id.unwrap_or_default();
    if buckets.is_empty() {
        buckets.insert(
            response
                .rate_limits
                .limit_id
                .clone()
                .unwrap_or_else(|| "codex".into()),
            response.rate_limits,
        );
    }
    Ok(CodexAccount {
        // A connection to the current local login, NOT an independently authenticated account.
        id: "codex-local",
        provider_id: "codex",
        source: "codex-app-server",
        account_id: response.account_id,
        email,
        plan_type,
        fetched_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        rate_limits: buckets,
    })
}

async fn send(input: &mut ChildStdin, value: Value) -> Result<(), QueryError> {
    let data = format!("{value}\n");
    input
        .write_all(data.as_bytes())
        .await
        .map_err(|_| error("connection", "Could not communicate with Codex."))
}
async fn rpc(
    input: &mut ChildStdin,
    output: &mut BufReader<ChildStdout>,
    id: u32,
    method: &str,
    params: Value,
) -> Result<Value, QueryError> {
    send(input, json!({"id":id,"method":method,"params":params})).await?;
    loop {
        let mut line = String::new();
        if output
            .read_line(&mut line)
            .await
            .map_err(|_| protocol_error())?
            == 0
        {
            return Err(error("connection", "Codex stopped unexpectedly. Check that Codex can start and its configuration is valid."));
        }
        let message: Value = serde_json::from_str(&line).map_err(|_| protocol_error())?;
        if message.get("method").is_some() {
            if let Some(request_id) = message.get("id") {
                send(input, json!({"id":request_id,"error":{"code":-32601,"message":"QuotaPeek only supports quota reads"}})).await?;
            }
            continue;
        }
        if message["id"] != id {
            continue;
        }
        if let Some(failure) = message.get("error") {
            // Classify internally; never expose raw upstream errors or credentials.
            let detail = failure["message"]
                .as_str()
                .unwrap_or_default()
                .to_lowercase();
            return Err(
                if detail.contains("401") || detail.contains("auth") || detail.contains("login") {
                    error(
                        "not_logged_in",
                        "Codex login is missing or expired. Sign in to Codex and retry.",
                    )
                } else if detail.contains("429") || detail.contains("too many") {
                    error(
                        "rate_limited",
                        "Too many quota requests. Wait a moment and retry.",
                    )
                } else {
                    error("query_failed", "Could not read Codex quota. Check your network, proxy and Codex login, then retry.")
                },
            );
        }
        return message.get("result").cloned().ok_or_else(protocol_error);
    }
}

fn executable() -> Result<PathBuf, QueryError> {
    crate::codex_executable::find().map_err(|message| error("codex_not_found", message))
}

async fn query() -> Result<CodexAccount, QueryError> {
    let mut command = Command::new(executable()?);
    command
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    // Use the user's home rather than loading configuration from the opened project.
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        command.current_dir(&home);
        if std::env::var_os("CODEX_HOME").is_none() {
            command.env("CODEX_HOME", home.join(".codex"));
        }
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = command.spawn().map_err(|_| {
        error(
            "launch_failed",
            "Could not start Codex. Check its executable and permissions.",
        )
    })?;
    let result = tokio::time::timeout(Duration::from_secs(45), async {
        let mut input = child.stdin.take().ok_or_else(protocol_error)?;
        let mut output = BufReader::new(child.stdout.take().ok_or_else(protocol_error)?);
        rpc(
            &mut input,
            &mut output,
            1,
            "initialize",
            json!({"clientInfo":{"name":"quotapeek","version":env!("CARGO_PKG_VERSION")}}),
        )
        .await?;
        send(&mut input, json!({"method":"initialized"})).await?;
        let account = rpc(
            &mut input,
            &mut output,
            2,
            "account/read",
            json!({"refreshToken":false}),
        )
        .await?;
        identity(&account)?;
        let limits = rpc(
            &mut input,
            &mut output,
            3,
            "account/rateLimits/read",
            Value::Null,
        )
        .await?;
        let after = rpc(
            &mut input,
            &mut output,
            4,
            "account/read",
            json!({"refreshToken":false}),
        )
        .await?;
        if account["account"] != after["account"] {
            return Err(error(
                "account_changed",
                "Codex account changed during the query. Retry to load the current account.",
            ));
        }
        snapshot(&after, limits)
    })
    .await;
    let _ = child.kill().await;
    result.unwrap_or_else(|_| {
        Err(error(
            "timeout",
            "Codex quota query timed out. Check your connection and retry.",
        ))
    })
}

#[tauri::command]
pub async fn query_codex_quota(
    state: tauri::State<'_, QueryState>,
) -> Result<CodexAccount, QueryError> {
    let _guard = state
        .0
        .try_lock()
        .map_err(|_| error("busy", "A Codex query is already running."))?;
    query().await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn account() -> Value {
        json!({"account":{"type":"chatgpt","email":"test@example.com","planType":"plus"}})
    }
    #[test]
    fn preserves_variable_windows_and_prefers_buckets() {
        let result = snapshot(&account(), json!({"rateLimits":{"primary":{"usedPercent":90}},"rateLimitsByLimitId":{"custom":{"primary":{"usedPercent":25,"windowDurationMins":15},"secondary":null}}})).unwrap();
        assert_eq!(result.provider_id, "codex");
        assert_eq!(result.rate_limits.len(), 1);
        assert_eq!(
            result.rate_limits["custom"]
                .primary
                .as_ref()
                .unwrap()
                .window_duration_mins,
            Some(15)
        );
        assert!(result.rate_limits["custom"].secondary.is_none());
        assert!(result.rate_limits["custom"]
            .primary
            .as_ref()
            .unwrap()
            .resets_at
            .is_none());
    }
    #[test]
    fn legacy_empty_and_malformed_windows() {
        assert!(snapshot(&account(), json!({"rateLimits":{}}))
            .unwrap()
            .rate_limits["codex"]
            .primary
            .is_none());
        assert!(snapshot(
            &account(),
            json!({"rateLimits":{"primary":{"resetsAt":123}}})
        )
        .is_err());
        assert!(snapshot(&account(), json!({})).is_err());
    }
    #[test]
    fn rejects_missing_login_and_api_keys() {
        assert_eq!(
            identity(&json!({"account":null})).unwrap_err().code,
            "not_logged_in"
        );
        assert_eq!(
            identity(&json!({"account":{"type":"apiKey"}}))
                .unwrap_err()
                .code,
            "unsupported_auth"
        );
    }
    #[tokio::test]
    #[ignore = "requires a signed-in local Codex installation and network"]
    async fn live_codex_query() {
        let result = query().await.unwrap();
        assert_eq!(result.provider_id, "codex");
        assert!(!result.rate_limits.is_empty());
        println!(
            "Codex query succeeded; {} quota buckets",
            result.rate_limits.len()
        );
    }
}
