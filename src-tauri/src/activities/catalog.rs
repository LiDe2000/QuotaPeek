use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};
pub const LIMIT: usize = 1_000_000;
pub const MOCK_ORIGIN: &str = "http://127.0.0.1:1432";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub schema_version: u32,
    pub revision: String,
    pub activities: Vec<Activity>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Activity {
    pub id: String,
    pub provider_id: String,
    pub title: String,
    pub reward: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub regions: Vec<String>,
    pub adapter_id: String,
    pub starts_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub query: Operation,
    pub claim: Option<Operation>,
}
fn enabled() -> bool {
    true
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Operation {
    pub request: Request,
    pub response: Mapping,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub query: BTreeMap<String, String>,
    pub body: Option<Value>,
    #[serde(default = "timeout")]
    pub timeout_ms: u64,
}
fn timeout() -> u64 {
    5000
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Mapping {
    pub rules: Vec<Rule>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    pub all: Vec<Condition>,
    pub status: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Condition {
    pub path: String,
    pub equals: Value,
}

pub fn valid_status(value: &str) -> bool {
    matches!(
        value,
        "unknown" | "available" | "claimed" | "verification" | "pending" | "failed"
    )
}
pub fn local_path(exe: &Path) -> Result<PathBuf, String> {
    Ok(exe
        .parent()
        .ok_or("Cannot locate the application directory.")?
        .join("activities.json"))
}
pub fn parse(content: &[u8]) -> Result<Catalog, String> {
    if content.len() > LIMIT {
        return Err("Activity configuration exceeds the size limit.".into());
    }
    let result: Catalog = serde_json::from_slice(content)
        .map_err(|_| "Invalid activity configuration JSON or schema.")?;
    if result.schema_version != 2
        || result.revision.trim().is_empty()
        || result.revision.len() > 200
        || result.activities.len() > 100
    {
        return Err("Unsupported activity configuration version or size.".into());
    }
    let mut ids = HashSet::new();
    for item in &result.activities {
        let id = item.id.as_bytes();
        if id.is_empty()
            || id.len() > 80
            || !id[0].is_ascii_lowercase() && !id[0].is_ascii_digit()
            || !id
                .iter()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-' || *b == b'_')
            || !ids.insert(&item.id)
            || !matches!(item.provider_id.as_str(), "workbuddy" | "zcode")
            || item.title.trim().is_empty()
            || item.title.len() > 2000
            || item.reward.trim().is_empty()
            || item.reward.len() > 2000
            || item.description.len() > 4000
            || item.regions.len() > 2
            || item
                .regions
                .iter()
                .any(|r| !matches!(r.as_str(), "cn" | "global"))
            || item
                .starts_at
                .zip(item.expires_at)
                .is_some_and(|(a, b)| a >= b)
        {
            return Err("Invalid activity metadata.".into());
        }
        validate_operation(item, &item.query, false)?;
        if let Some(op) = &item.claim {
            validate_operation(item, op, true)?;
        }
    }
    Ok(result)
}
pub fn validate_operation(
    activity: &Activity,
    op: &Operation,
    claiming: bool,
) -> Result<(), String> {
    let request = &op.request;
    let url = reqwest::Url::parse(&request.url).map_err(|_| "Invalid activity URL.")?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some()
        || request.url != format!("{}{}", url.origin().ascii_serialization(), url.path())
        || !(500..=30000).contains(&request.timeout_ms)
        || request.query.len() > 30
        || request
            .query
            .iter()
            .any(|(k, v)| k.len() > 200 || v.len() > 2000)
        || request.body.as_ref().is_some_and(|v| !v.is_object())
        || request.method == "GET" && request.body.is_some()
    {
        return Err("Unsupported activity request fields.".into());
    }
    let (origin, path, method) = match activity.adapter_id.as_str() {
        "mock-http-v1" => (
            MOCK_ORIGIN,
            format!(
                "/mock/{}/{}",
                activity.provider_id,
                if claiming { "claim" } else { "status" }
            ),
            if claiming { "POST" } else { "GET" },
        ),
        "workbuddy-checkin-v1" if activity.provider_id == "workbuddy" => (
            "https://copilot.tencent.com",
            format!(
                "/v2/billing/meter/{}",
                if claiming {
                    "daily-checkin"
                } else {
                    "checkin-activity-status"
                }
            ),
            "POST",
        ),
        "zcode-preview-v1" if activity.provider_id == "zcode" && !claiming => (
            "https://zcode.z.ai",
            "/api/v1/zcode-plan/billing/preview".into(),
            "GET",
        ),
        "zcode-plan-v1" if activity.provider_id == "zcode" => (
            "https://zcode.z.ai",
            format!(
                "/api/v1/zcode-plan/billing/{}",
                if claiming { "claim" } else { "preview" }
            ),
            if claiming { "POST" } else { "GET" },
        ),
        _ => return Err("Unsupported activity adapter or operation.".into()),
    };
    if url.origin().ascii_serialization() != origin
        || url.path() != path
        || request.method != method
    {
        return Err("Activity endpoint is outside the built-in provider policy.".into());
    }
    // Runtime owns the selected plan and all claim parameters.
    if activity.adapter_id == "zcode-plan-v1"
        && claiming
        && (!request.query.is_empty()
            || request
                .body
                .as_ref()
                .is_some_and(|v| v.as_object().is_none_or(|o| !o.is_empty())))
    {
        return Err("ZCode claim parameters are generated locally.".into());
    }
    if op.response.rules.len() > 30
        || op.response.rules.iter().any(|r| {
            !valid_status(&r.status)
                || r.all.is_empty()
                || r.all.len() > 10
                || r.all
                    .iter()
                    .any(|c| c.path.is_empty() || c.path.len() > 200)
        })
    {
        return Err("Invalid activity response rules.".into());
    }
    Ok(())
}
pub fn active(item: &Activity, now: u64) -> bool {
    item.enabled
        && item.starts_at.is_none_or(|v| now >= v)
        && item.expires_at.is_none_or(|v| now < v)
}
pub fn sample_account(provider: &str, id: &str) -> bool {
    match provider {
        "workbuddy" => matches!(id, "preview-wb-0" | "preview-wb-1" | "preview-wb-2"),
        "zcode" => matches!(id, "preview-zc-0" | "preview-zc-1"),
        _ => false,
    }
}
pub fn at<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.')
        .try_fold(value, |v, key| v.as_object()?.get(key))
}
