use super::{
    begin_request, catalog, engine::Outcome, permitted_activity, transport, ActivityState, Session,
};
use reqwest::header::HeaderMap;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const ROOT: &str = "https://zcode.z.ai/api/v1";
const MANUAL: &str = "Complete verification and claim in the official ZCode app.";
const PENDING: &str =
    "Claim submitted; rewards are not yet confirmed. Check the official ZCode app before retrying.";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptchaConfig {
    region: String,
    prefix: String,
    scene_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preparation {
    status: String,
    note: String,
    ticket: Option<String>,
    captcha: Option<CaptchaConfig>,
}
impl Preparation {
    fn outcome(outcome: Outcome) -> Self {
        Self {
            status: outcome.status,
            note: outcome.note,
            ticket: None,
            captcha: None,
        }
    }
}
pub(super) struct Challenge {
    activity: String,
    account: String,
    plan: String,
    region: String,
    baseline: Value,
    created: Instant,
}
pub(super) struct Submission {
    pub plan: String,
    baseline: Value,
    outcome: Outcome,
}
impl Submission {
    pub fn new(plan: String, baseline: Value) -> Self {
        Self {
            plan,
            baseline,
            outcome: Outcome::new("pending", PENDING),
        }
    }
    pub fn confirmed(&self, balance: &Value) -> bool {
        if balance.get("code") != Some(&json!(0)) {
            return false;
        }
        balance
            .pointer("/data/plans")
            .and_then(Value::as_array)
            .is_some_and(|plans| {
                plans.iter().any(|plan| {
                    plan["plan_id"].as_str() == Some(&self.plan)
                        && plan["status"].as_str() == Some("active")
                        && !self
                            .baseline
                            .pointer("/data/plans")
                            .and_then(Value::as_array)
                            .is_some_and(|old| {
                                old.iter().any(|before| {
                                    before["plan_id"] == plan["plan_id"]
                                        && plan_grant(before) == plan_grant(plan)
                                })
                            })
                })
            })
    }
}
// Display-name/priority changes cannot be mistaken for a newly granted reward.
fn plan_grant(plan: &Value) -> Value {
    let mut grants: Vec<Value> = plan["entitlements"].as_array().into_iter().flatten().map(|e| json!({
        "id":e["entitlement_id"], "units":e["grant_units"], "effective":e["effective_at"], "period":e["period"]
    })).collect();
    grants.sort_by_cached_key(Value::to_string);
    json!({"user":plan["user_plan_id"], "status":plan["status"], "starts":plan["starts_at"], "ends":plan["ends_at"], "grants":grants})
}
fn plan_ids(payload: &Value) -> Option<Vec<String>> {
    if payload.get("code").is_some_and(|v| v != 0) {
        return None;
    }
    let plans = payload.pointer("/data/plans")?.as_array()?;
    plans
        .iter()
        .map(|p| {
            let id = p["plan_id"].as_str()?.trim();
            (!id.is_empty() && id.len() <= 200).then(|| id.to_owned())
        })
        .collect()
}
pub fn preview(payload: &Value, claim_enabled: bool) -> Outcome {
    match plan_ids(payload) {
        Some(plans) if claim_enabled && plans.len() == 1 => Outcome::new("available", ""),
        Some(plans) if !plans.is_empty() => Outcome::new("verification", MANUAL),
        _ => Outcome::new("unknown", "No single claimable ZCode plan was returned."),
    }
}
fn parameters() -> std::collections::BTreeMap<String, String> {
    let mut query = std::collections::BTreeMap::new();
    crate::providers::zcode::activity_query_parameters(&mut query);
    query
}
async fn get(path: &str, headers: &HeaderMap) -> Result<Value, String> {
    let url = format!("{ROOT}/{path}");
    let response = transport::client(&url)?
        .get(url)
        .headers(headers.clone())
        .query(&parameters())
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| "Could not reach ZCode.")?;
    if !response.status().is_success() {
        return Err("ZCode rejected the request.".into());
    }
    transport::json(response).await
}
async fn balance(headers: &HeaderMap) -> Result<Value, String> {
    let value = get("zcode-plan/billing/balance", headers).await?;
    if value.get("code") != Some(&json!(0))
        || value
            .pointer("/data/plans")
            .and_then(Value::as_array)
            .is_none()
    {
        return Err("ZCode returned an unsupported balance response.".into());
    }
    Ok(value)
}
async fn check(submission: &mut Submission, headers: &HeaderMap) -> Outcome {
    if submission.outcome.status == "pending" {
        if let Ok(value) = balance(headers).await {
            if submission.confirmed(&value) {
                submission.outcome = Outcome::new(
                    "claimed",
                    "ZCode rewards confirmed in the official balance.",
                );
            }
        }
    }
    submission.outcome.clone()
}
fn previous_submission<'a>(
    session: &'a mut Session,
    account: &str,
    payload: &Value,
) -> Option<&'a mut Submission> {
    let ids = plan_ids(payload)?;
    if ids.len() == 1 {
        return session
            .submissions
            .get_mut(&(account.into(), ids[0].clone()));
    }
    if ids.is_empty() {
        // Claimed plans disappear from preview. Absence alone proves nothing,
        // but must not erase a receipt already confirmed against the balance.
        return session
            .submissions
            .iter_mut()
            .find_map(|((owner, _), receipt)| {
                (owner == account && receipt.outcome.status == "claimed").then_some(receipt)
            });
    }
    None
}
pub(super) async fn query(
    session: &mut Session,
    activity: &catalog::Activity,
    account: &str,
    headers: &HeaderMap,
) -> Outcome {
    // Pending submissions survive configuration reloads and block another POST.
    for ((owner, _), submission) in &mut session.submissions {
        if owner == account && submission.outcome.status == "pending" {
            return check(submission, headers).await;
        }
    }
    let payload = match get("zcode-plan/billing/preview", headers).await {
        Ok(value) => value,
        Err(error) => return Outcome::new("unknown", &error),
    };
    if let Some(previous) = previous_submission(session, account, &payload) {
        return check(previous, headers).await;
    }
    preview(&payload, activity.claim.is_some())
}
fn captcha_config(value: &Value) -> Option<CaptchaConfig> {
    if value.get("code") != Some(&json!(0)) {
        return None;
    }
    let config = value.pointer("/data/configs/captcha")?;
    if config["enabled"].as_bool() != Some(true) {
        return None;
    }
    let region = config["region"].as_str()?;
    let prefix = config["prefix"].as_str()?;
    let scene_id = config["sceneId"].as_str()?;
    let identifier = |s: &str| {
        !s.is_empty()
            && s.len() <= 80
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    };
    if !matches!(region, "cn" | "sg") || !identifier(prefix) || !identifier(scene_id) {
        return None;
    }
    Some(CaptchaConfig {
        region: region.into(),
        prefix: prefix.into(),
        scene_id: scene_id.into(),
    })
}
#[tauri::command]
pub async fn activity_prepare_zcode_claim(
    state: tauri::State<'_, ActivityState>,
    app: tauri::AppHandle,
    session_id: String,
    activity_id: String,
    account_id: String,
) -> Result<Preparation, String> {
    let mut session = state.session.lock().await;
    let activity = begin_request(&mut session, &session_id, &activity_id, &account_id, true)?;
    if activity.adapter_id != "zcode-plan-v1" {
        return Err("This activity does not support local ZCode verification.".into());
    }
    let op = activity
        .claim
        .as_ref()
        .ok_or("No ZCode claim operation is configured.")?;
    catalog::validate_operation(&activity, op, true)?;
    let headers =
        crate::providers::zcode::activity_headers(&app, &account_id, &activity.regions).await?;
    let payload = get("zcode-plan/billing/preview", &headers).await?;
    let ids = plan_ids(&payload).ok_or("Unsupported ZCode activity preview.")?;
    if ids.len() != 1 {
        return Ok(Preparation::outcome(Outcome::new("verification", MANUAL)));
    }
    let plan = ids[0].clone();
    if let Some(submission) = session
        .submissions
        .get_mut(&(account_id.clone(), plan.clone()))
    {
        return Ok(Preparation::outcome(check(submission, &headers).await));
    }
    let baseline = balance(&headers).await?;
    let config = get("client/configs", &HeaderMap::new())
        .await
        .ok()
        .and_then(|v| captcha_config(&v));
    let Some(captcha) = config else {
        return Ok(Preparation::outcome(Outcome::new("verification", MANUAL)));
    };
    // Keep tickets transient, bound to one account/plan/configuration, and single use.
    session
        .challenges
        .retain(|_, c| c.created.elapsed().as_secs() < 90);
    if session.challenges.len() >= 100 {
        return Err("Too many verification requests.".into());
    }
    let ticket = uuid::Uuid::new_v4().to_string();
    session.challenges.insert(
        ticket.clone(),
        Challenge {
            activity: activity_id,
            account: account_id,
            plan,
            region: captcha.region.clone(),
            baseline,
            created: Instant::now(),
        },
    );
    Ok(Preparation {
        status: "available".into(),
        note: String::new(),
        ticket: Some(ticket),
        captcha: Some(captcha),
    })
}

#[tauri::command]
pub async fn activity_submit_zcode_claim(
    state: tauri::State<'_, ActivityState>,
    app: tauri::AppHandle,
    session_id: String,
    ticket: String,
    captcha_verify_param: Option<String>,
) -> Result<Outcome, String> {
    let mut session = state.session.lock().await;
    if session.id != session_id {
        return Err("Activity configuration changed. Refresh before continuing.".into());
    }
    let challenge = session
        .challenges
        .remove(&ticket)
        .ok_or("Verification ticket expired or was already used.")?;
    let key = (challenge.activity.clone(), challenge.account.clone());
    let outcome = async {
        let Some(param) = captcha_verify_param.filter(|p| (16..=8192).contains(&p.len())) else {
            return Ok(Outcome::new("verification", MANUAL));
        };
        if challenge.created.elapsed().as_secs() >= 90 {
            return Ok(Outcome::new("verification", MANUAL));
        }
        let activity = permitted_activity(&session, &challenge.activity, &challenge.account)?;
        if activity.adapter_id != "zcode-plan-v1" {
            return Err("Unsupported claim operation.".into());
        }
        let op = activity
            .claim
            .as_ref()
            .ok_or("No ZCode claim operation is configured.")?;
        catalog::validate_operation(&activity, op, true)?;
        let mut headers =
            crate::providers::zcode::activity_headers(&app, &challenge.account, &activity.regions)
                .await?;
        let fresh = get("zcode-plan/billing/preview", &headers).await?;
        if !plan_ids(&fresh).is_some_and(|ids| ids.contains(&challenge.plan)) {
            return Ok(Outcome::new(
                "unknown",
                "This ZCode plan is no longer available.",
            ));
        }
        let submission_key = (challenge.account.clone(), challenge.plan.clone());
        if let Some(previous) = session.submissions.get_mut(&submission_key) {
            return Ok(check(previous, &headers).await);
        }
        let params = parameters();
        headers.insert(
            "x-zcode-app-version",
            params["app_version"]
                .parse()
                .map_err(|_| "Invalid client version.")?,
        );
        headers.insert(
            "x-platform",
            params["platform"]
                .parse()
                .map_err(|_| "Invalid platform.")?,
        );
        let mut verification: reqwest::header::HeaderValue =
            param.parse().map_err(|_| "Invalid verification result.")?;
        verification.set_sensitive(true);
        headers.insert("x-aliyun-captcha-verify-param", verification);
        headers.insert(
            "x-aliyun-captcha-verify-region",
            challenge
                .region
                .parse()
                .map_err(|_| "Invalid verification region.")?,
        );
        let client = transport::client(&op.request.url)?;
        // Record before sending. A timeout never authorizes an automatic retry.
        session.submissions.insert(
            submission_key.clone(),
            Submission::new(challenge.plan.clone(), challenge.baseline),
        );
        let response = client
            .post(&op.request.url)
            .headers(headers)
            .json(&json!({"plan_id":challenge.plan}))
            .timeout(Duration::from_millis(op.request.timeout_ms))
            .send()
            .await;
        let payload = match response {
            Ok(response) => transport::json(response).await.ok(),
            Err(_) => None,
        };
        if let Some(payload) = &payload {
            if payload
                .get("code")
                .and_then(Value::as_i64)
                .is_some_and(|code| code != 0)
            {
                session.submissions.remove(&submission_key);
                return Ok(Outcome::new("verification", MANUAL));
            }
        }
        let readonly =
            crate::providers::zcode::activity_headers(&app, &challenge.account, &activity.regions)
                .await;
        let submission = session.submissions.get_mut(&submission_key).unwrap();
        match readonly {
            Ok(headers) => Ok(check(submission, &headers).await),
            Err(_) => Ok(submission.outcome.clone()),
        }
    }
    .await;
    if let Ok(value) = &outcome {
        session.states.insert(key, (value.clone(), Instant::now()));
    }
    outcome
}

#[cfg(all(test, target_os = "windows"))]
#[path = "../../../tests/rust/zcode_activity.rs"]
mod tests;
