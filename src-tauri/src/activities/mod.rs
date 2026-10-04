mod catalog;
mod engine;
mod transport;
pub(crate) mod zcode;
use catalog::{Activity, Catalog};
use engine::Outcome;
use std::{
    collections::HashMap,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;

#[derive(Default)]
struct Session {
    catalog: Option<Catalog>,
    id: String,
    demo: bool,
    states: HashMap<(String, String), (Outcome, Instant)>,
    challenges: HashMap<String, zcode::Challenge>,
    submissions: HashMap<(String, String), zcode::Submission>,
}
#[derive(Default)]
pub struct ActivityState {
    session: Mutex<Session>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[tauri::command]
pub async fn activity_load_catalog(
    state: tauri::State<'_, ActivityState>,
    source: String,
    demo: bool,
) -> Result<transport::Loaded, String> {
    // One lock serializes catalog replacement and requests; old sessions cannot submit.
    let mut session = state.session.lock().await;
    // A catalog reload cannot authorize a second submission after an uncertain result.
    let submissions = std::mem::take(&mut session.submissions);
    *session = Session {
        submissions,
        ..Session::default()
    };
    if demo && !cfg!(debug_assertions) {
        return Err("Activity preview is available only in development builds.".into());
    }
    let exe = std::env::current_exe().map_err(|_| "Cannot locate the application.")?;
    let mut loaded = transport::load(&source, &catalog::local_path(&exe)?).await;
    loaded.session = uuid::Uuid::new_v4().to_string();
    session.id = loaded.session.clone();
    session.catalog = loaded.catalog.clone();
    session.demo = demo;
    Ok(loaded)
}
fn permitted_activity(session: &Session, id: &str, account: &str) -> Result<Activity, String> {
    let item = session
        .catalog
        .as_ref()
        .and_then(|c| c.activities.iter().find(|a| a.id == id))
        .ok_or("Activity is not in the current configuration.")?;
    if !catalog::active(item, now()) {
        return Err("Activity is disabled, not started, or expired.".into());
    }
    let mock = item.adapter_id == "mock-http-v1";
    if mock != session.demo
        || mock && (!cfg!(debug_assertions) || !catalog::sample_account(&item.provider_id, account))
    {
        return Err("Sample activities and real accounts cannot be mixed.".into());
    }
    Ok(item.clone())
}
fn begin_request(
    session: &mut Session,
    session_id: &str,
    activity_id: &str,
    account_id: &str,
    claiming: bool,
) -> Result<Activity, String> {
    if session.id != session_id {
        return Err("Activity configuration changed. Refresh before continuing.".into());
    }
    let item = permitted_activity(session, activity_id, account_id)?;
    let key = (activity_id.to_owned(), account_id.to_owned());
    if claiming {
        let ready = session
            .states
            .get(&key)
            .is_some_and(|(o, at)| o.status == "available" && at.elapsed().as_secs() < 300);
        if !ready {
            return Err("Refresh and confirm availability before claiming.".into());
        }
    }
    // Revoke old availability before any credential access or network await, including queries.
    session.states.insert(
        key,
        (
            Outcome::new(
                if claiming { "pending" } else { "unknown" },
                "Request in progress.",
            ),
            Instant::now(),
        ),
    );
    Ok(item)
}
#[tauri::command]
pub async fn activity_execute(
    state: tauri::State<'_, ActivityState>,
    app: tauri::AppHandle,
    session_id: String,
    activity_id: String,
    account_id: String,
    claiming: bool,
) -> Result<Outcome, String> {
    let mut session = state.session.lock().await;
    let item = begin_request(
        &mut session,
        &session_id,
        &activity_id,
        &account_id,
        claiming,
    )?;
    let key = (activity_id, account_id.clone());
    let headers = if item.adapter_id == "mock-http-v1" {
        reqwest::header::HeaderMap::new()
    } else {
        // Endpoint policy was checked when loading and is checked again before accessing credentials.
        catalog::validate_operation(&item, &item.query, false)?;
        if let Some(operation) = &item.claim {
            catalog::validate_operation(&item, operation, true)?;
        }
        match item.provider_id.as_str() {
            "workbuddy" => {
                crate::providers::workbuddy::activity_headers(&app, &account_id, &item.regions)
                    .await?
            }
            "zcode" => {
                crate::providers::zcode::activity_headers(&app, &account_id, &item.regions).await?
            }
            _ => return Err("Unsupported provider.".into()),
        }
    };
    let mut execution = item.clone();
    if matches!(
        item.adapter_id.as_str(),
        "zcode-preview-v1" | "zcode-plan-v1"
    ) {
        crate::providers::zcode::activity_query_parameters(&mut execution.query.request.query);
    }
    let outcome = if item.adapter_id == "zcode-plan-v1" && !claiming {
        zcode::query(&mut session, &execution, &account_id, &headers).await
    } else {
        engine::execute(&execution, &account_id, &headers, claiming).await
    };
    session
        .states
        .insert(key, (outcome.clone(), Instant::now()));
    Ok(outcome)
}

#[cfg(test)]
#[path = "../../../tests/rust/activities.rs"]
mod tests;
