use super::{
    catalog::{self, Activity, Mapping, Operation},
    transport,
};
use reqwest::header::HeaderMap;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Serialize)]
pub struct Outcome {
    pub status: String,
    pub note: String,
}
impl Outcome {
    pub fn new(status: &str, note: &str) -> Self {
        Self {
            status: status.into(),
            note: note.into(),
        }
    }
}
pub fn normalize(payload: &Value, mapping: &Mapping, claiming: bool) -> Outcome {
    let status = mapping
        .rules
        .iter()
        .find(|rule| {
            rule.all.iter().all(|condition| {
                catalog::at(payload, &condition.path).is_some_and(|v| v == &condition.equals)
            })
        })
        .map(|r| r.status.as_str())
        .unwrap_or(if claiming { "pending" } else { "unknown" });
    Outcome::new(
        if claiming && matches!(status, "available" | "unknown") {
            "pending"
        } else {
            status
        },
        "",
    )
}
pub fn zcode_preview(payload: &Value) -> Outcome {
    if payload.get("code").is_some_and(|v| v != 0) {
        return Outcome::new("unknown", "ZCode rejected the activity preview.");
    }
    let Some(plans) = payload.pointer("/data/plans").and_then(Value::as_array) else {
        return Outcome::new("unknown", "ZCode returned an unsupported activity preview.");
    };
    if plans.iter().any(|p| {
        p.get("plan_id")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.trim().is_empty())
    }) {
        Outcome::new("verification", "Activity plans found. Complete verification and claim in the official ZCode app; eligibility and rewards are determined there.")
    } else {
        Outcome::new("unknown", "No claimable plans were returned by ZCode.")
    }
}
pub async fn request(
    activity: &Activity,
    operation: &Operation,
    account: &str,
    headers: &HeaderMap,
    claiming: bool,
) -> Outcome {
    let failure = |note: &str| Outcome::new(if claiming { "pending" } else { "unknown" }, note);
    if let Err(error) = catalog::validate_operation(activity, operation, claiming) {
        return failure(&error);
    }
    let spec = &operation.request;
    let Ok(client) = transport::client(&spec.url) else {
        return failure("Could not create activity HTTP client.");
    };
    let method = if spec.method == "POST" {
        reqwest::Method::POST
    } else {
        reqwest::Method::GET
    };
    let mut query = spec.query.clone();
    let mut body = spec.body.clone();
    if activity.adapter_id == "mock-http-v1" {
        if !catalog::sample_account(&activity.provider_id, account) || !headers.is_empty() {
            return failure("Mock activities accept only sample accounts without credentials.");
        }
        if claiming {
            body = Some(json!({"account_id": account}));
        } else {
            query.insert("account_id".into(), account.into());
        }
    }
    let mut request = client
        .request(method, &spec.url)
        .headers(headers.clone())
        .query(&query)
        .timeout(Duration::from_millis(spec.timeout_ms));
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(_) => {
            return failure("Activity request failed or timed out. Refresh status before retrying.")
        }
    };
    let http_status = response.status().as_u16();
    if http_status == 401 || http_status == 403 {
        return Outcome::new(
            "unknown",
            "Official activity authorization was rejected. Reconnect or check the official app.",
        );
    }
    let payload = match transport::json(response).await {
        Ok(value) => value,
        Err(error) => return failure(&error),
    };
    // WorkBuddy sometimes reports already-claimed as HTTP 400, code 10001.
    if !(200..300).contains(&http_status)
        && !(activity.adapter_id == "workbuddy-checkin-v1"
            && claiming
            && http_status == 400
            && payload.get("code") == Some(&json!(10001)))
    {
        return failure(
            "Official activity returned an HTTP error. Refresh status before retrying.",
        );
    }
    if activity.adapter_id == "zcode-preview-v1" {
        return zcode_preview(&payload);
    }
    if activity.adapter_id == "zcode-plan-v1" {
        return super::zcode::preview(&payload, activity.claim.is_some());
    }
    normalize(&payload, &operation.response, claiming)
}
/// Claims are followed only by a read-only query, never by an automatic second submission.
pub async fn execute(
    activity: &Activity,
    account: &str,
    headers: &HeaderMap,
    claiming: bool,
) -> Outcome {
    if matches!(
        activity.adapter_id.as_str(),
        "zcode-preview-v1" | "zcode-plan-v1"
    ) && claiming
    {
        return Outcome::new(
            "verification",
            "Complete verification and claim in the official ZCode app.",
        );
    }
    if !claiming {
        return request(activity, &activity.query, account, headers, false).await;
    }
    let Some(operation) = &activity.claim else {
        return Outcome::new("unknown", "This activity has no claim operation.");
    };
    let before = request(activity, &activity.query, account, headers, false).await;
    if before.status != "available" {
        return before;
    }
    let result = request(activity, operation, account, headers, true).await;
    if activity.adapter_id == "workbuddy-checkin-v1"
        || matches!(result.status.as_str(), "claimed" | "pending")
    {
        let verified = request(activity, &activity.query, account, headers, false).await;
        if verified.status == "claimed" {
            return verified;
        }
        if result.status == "verification" {
            return result;
        }
        return Outcome::new(
            "pending",
            "Claim submitted; completion is not confirmed. Refresh status before retrying.",
        );
    }
    result
}
