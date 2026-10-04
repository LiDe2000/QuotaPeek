use super::*;
use tauri::Manager;

#[tokio::test]
async fn confirmed_claim_survives_empty_preview_after_catalog_reload() {
    let mut session = Session::default();
    let mut receipt = Submission::new("trust".into(), json!({"code":0,"data":{"plans":[]}}));
    receipt.outcome = Outcome::new("claimed", "Rewards confirmed.");
    session.submissions.insert(("account".into(), "trust".into()), receipt);
    // Catalog reloads preserve submissions, while clearing the ordinary status cache.
    session.states.clear();
    let empty = json!({"code":0,"data":{"plans":[]}});
    let previous = previous_submission(&mut session, "account", &empty)
        .expect("confirmed receipt must remain visible when the claimed plan leaves preview");
    // Confirmed receipts do not issue another network request, even with no credentials.
    assert_eq!(check(previous, &HeaderMap::new()).await.status, "claimed");
    assert!(previous_submission(&mut session, "other-account", &empty).is_none());
    assert!(previous_submission(&mut session, "account", &json!({"code":400,"data":{"plans":[]}})).is_none());
    assert!(previous_submission(&mut session, "account", &json!({"code":0,"data":{"plans":[{"plan_id":"new-reward"}]}})).is_none());
    assert_eq!(preview(&empty, true).status, "unknown", "empty preview alone is not proof of a claim");
}

#[tokio::test]
async fn failed_or_expired_verification_consumes_the_ticket_without_accessing_credentials() {
    // No database or provider state: reaching credential access would panic.
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(ActivityState::default())
        .build(context)
        .unwrap();
    let state = app.state::<ActivityState>();
    {
        let mut session = state.session.lock().await;
        session.id = "current".into();
        for (ticket, seconds) in [("failed", 0), ("expired", 91)] {
            session.challenges.insert(
                ticket.into(),
                Challenge {
                    activity: "a".into(),
                    account: "a".into(),
                    plan: "p".into(),
                    region: "cn".into(),
                    baseline: json!({}),
                    created: Instant::now() - Duration::from_secs(seconds),
                },
            );
        }
    }
    let failed = activity_submit_zcode_claim(
        app.state(),
        app.handle().clone(),
        "current".into(),
        "failed".into(),
        None,
    )
    .await
    .unwrap();
    assert_eq!(failed.status, "verification");
    assert!(activity_submit_zcode_claim(
        app.state(),
        app.handle().clone(),
        "current".into(),
        "failed".into(),
        Some("opaque-verification-result".into())
    )
    .await
    .is_err());
    let expired = activity_submit_zcode_claim(
        app.state(),
        app.handle().clone(),
        "current".into(),
        "expired".into(),
        Some("opaque-verification-result".into()),
    )
    .await
    .unwrap();
    assert_eq!(expired.status, "verification");
    assert!(state.session.lock().await.challenges.is_empty());
    assert!(state.session.lock().await.submissions.is_empty());
}
