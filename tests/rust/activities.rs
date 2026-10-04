use super::*;
use reqwest::header::HeaderMap;
use serde_json::json;

// Tauri links its manifest to application binaries, but not library unit tests.
// Reuse that resource for Wry tests so TaskDialogIndirect resolves via Controls v6.
#[cfg(target_os = "windows")]
#[link(name = "resource", kind = "static")]
unsafe extern "C" {}

fn mock_catalog() -> Catalog {
    catalog::parse(include_bytes!("../../tests/activity_mock/activities.json")).unwrap()
}

#[test]
fn zcode_claim_adapter_allows_only_official_claim_and_requires_one_plan() {
    let mut live: serde_json::Value =
        serde_json::from_slice(include_bytes!("../../activity-service/activities.json")).unwrap();
    live["activities"][1]["adapterId"] = json!("zcode-plan-v1");
    live["activities"][1]["claim"] = json!({"request":{"url":"https://zcode.z.ai/api/v1/zcode-plan/billing/claim","method":"POST","body":{}},"response":{"rules":[]}});
    assert!(catalog::parse(&serde_json::to_vec(&live).unwrap()).is_ok());
    live["activities"][1]["claim"]["request"]["url"] = json!("https://evil.example/claim");
    assert!(catalog::parse(&serde_json::to_vec(&live).unwrap()).is_err());
    assert_eq!(
        zcode::preview(
            &json!({"code":0,"data":{"plans":[{"plan_id":"trust"}]}}),
            true
        )
        .status,
        "available"
    );
    assert_eq!(
        zcode::preview(
            &json!({"code":0,"data":{"plans":[{"plan_id":"trust"},{"plan_id":"weekend"}]}}),
            true
        )
        .status,
        "verification"
    );
    assert_eq!(
        zcode::preview(&json!({"code":0,"data":{"plans":[]}}), true).status,
        "unknown"
    );
}

#[test]
fn zcode_claim_receipt_requires_a_changed_active_plan_in_readback() {
    let receipt = zcode::Submission::new("trust".into(), json!({"code":0,"data":{"plans":[]}}));
    assert!(!receipt
        .confirmed(&json!({"code":0,"data":{"plans":[{"plan_id":"weekend","status":"active"}]}})));
    assert!(!receipt
        .confirmed(&json!({"code":0,"data":{"plans":[{"plan_id":"trust","status":"expired"}]}})));
    assert!(receipt
        .confirmed(&json!({"code":0,"data":{"plans":[{"plan_id":"trust","status":"active"}]}})));
    let existing = zcode::Submission::new(
        "trust".into(),
        json!({"code":0,"data":{"plans":[{"plan_id":"trust","status":"active"}]}}),
    );
    assert!(!existing
        .confirmed(&json!({"code":0,"data":{"plans":[{"plan_id":"trust","status":"active"}]}})));
    assert!(!existing.confirmed(&json!({"code":0,"data":{"plans":[{"plan_id":"trust","status":"active","name":"changed display name"}]}})));
    assert!(!receipt
        .confirmed(&json!({"code":400,"data":{"plans":[{"plan_id":"trust","status":"active"}]}})));
}
#[test]
fn configs_share_schema_and_reject_unknown_destinations_or_auth_fields() {
    assert_eq!(mock_catalog().schema_version, 2);
    catalog::parse(include_bytes!("../../activity-service/activities.json")).unwrap();
    let base: serde_json::Value =
        serde_json::from_slice(include_bytes!("../../tests/activity_mock/activities.json"))
            .unwrap();
    for url in [
        "https://evil.example/mock/workbuddy/status",
        "http://127.0.0.1:1432@evil.example/mock/workbuddy/status",
        "http://127.0.0.1:1432/mock/workbuddy/status?token=x",
        "http://localhost:1432/mock/workbuddy/status",
        "http://127.0.0.1:1432/mock/workbuddy/../workbuddy/status",
    ] {
        let mut bad = base.clone();
        bad["activities"][0]["query"]["request"]["url"] = json!(url);
        assert!(
            catalog::parse(&serde_json::to_vec(&bad).unwrap()).is_err(),
            "{url}"
        );
    }
    let mut bad = base.clone();
    bad["activities"][0]["query"]["request"]["headers"] = json!({"Authorization":"secret"});
    assert!(catalog::parse(&serde_json::to_vec(&bad).unwrap()).is_err());
    let mut bad = base.clone();
    bad["activities"][0]["query"]["request"]["method"] = json!("DELETE");
    assert!(catalog::parse(&serde_json::to_vec(&bad).unwrap()).is_err());
    let mut bad = base;
    bad["activities"][1] = bad["activities"][0].clone();
    assert!(catalog::parse(&serde_json::to_vec(&bad).unwrap()).is_err());
}
#[test]
fn missing_fields_do_not_match_null_and_unconfirmed_claims_stay_pending() {
    let mapping = catalog::Mapping {
        rules: vec![catalog::Rule {
            all: vec![catalog::Condition {
                path: "data.missing".into(),
                equals: serde_json::Value::Null,
            }],
            status: "claimed".into(),
        }],
    };
    assert_eq!(
        engine::normalize(&json!({"data":{}}), &mapping, true).status,
        "pending"
    );
    assert_eq!(
        engine::normalize(&json!({"data":{"missing":null}}), &mapping, true).status,
        "claimed"
    );
    let cfg = mock_catalog();
    let op = &cfg.activities[0].query;
    assert_eq!(
        engine::normalize(&json!({"data":{"state":"available"}}), &op.response, true).status,
        "pending"
    );
    assert_eq!(
        engine::normalize(&json!({"data":{"state":"available"}}), &op.response, false).status,
        "available"
    );
}
#[test]
fn workbuddy_requires_all_eligibility_fields_and_zcode_does_not_enable_claims() {
    let live = catalog::parse(include_bytes!("../../activity-service/activities.json")).unwrap();
    let mapping = &live.activities[0].query.response;
    assert_eq!(
        engine::normalize(
            &json!({"code":0,"data":{"active":true,"today_checked_in":false}}),
            mapping,
            false
        )
        .status,
        "available"
    );
    for body in [
        json!({"code":403,"data":{"active":true,"today_checked_in":false}}),
        json!({"code":0,"data":{"active":false,"today_checked_in":false}}),
        json!({"code":0,"data":{"active":true}}),
    ] {
        assert_eq!(engine::normalize(&body, mapping, false).status, "unknown");
    }
    assert_eq!(
        engine::zcode_preview(&json!({"code":0,"data":{"plans":[{"plan_id":"p"}]}})).status,
        "verification"
    );
    assert_eq!(
        engine::zcode_preview(&json!({"code":3001,"data":{"plans":[{"plan_id":"p"}]}})).status,
        "unknown"
    );
    assert_eq!(
        engine::zcode_preview(&json!({"code":0,"data":{"plans":[]}})).status,
        "unknown"
    );
}
#[test]
fn local_file_is_exe_relative_and_mock_sessions_reject_real_accounts() {
    assert_eq!(
        catalog::local_path(std::path::Path::new("bundle/quotapeek.exe")).unwrap(),
        std::path::Path::new("bundle/activities.json")
    );
    let mut session = Session {
        catalog: Some(mock_catalog()),
        demo: true,
        ..Default::default()
    };
    assert!(permitted_activity(&session, "workbuddy-daily", "real-account").is_err());
    assert!(permitted_activity(&session, "workbuddy-daily", "preview-zc-0").is_err());
    assert!(permitted_activity(&session, "workbuddy-daily", "preview-wb-0").is_ok());
    session.demo = false;
    assert!(permitted_activity(&session, "workbuddy-daily", "preview-wb-0").is_err());
    let mut item = mock_catalog().activities.remove(0);
    item.expires_at = Some(10);
    assert!(!catalog::active(&item, 10));
    item.starts_at = Some(5);
    assert!(!catalog::active(&item, 4));
}
#[test]
fn stale_sessions_expired_queries_and_duplicate_claims_are_rejected_before_network() {
    let mut session = Session {
        id: "current".into(),
        catalog: Some(mock_catalog()),
        demo: true,
        ..Default::default()
    };
    let key: (String, String) = ("workbuddy-daily".into(), "preview-wb-0".into());
    assert!(begin_request(&mut session, "old", &key.0, &key.1, false).is_err());
    assert!(begin_request(&mut session, "current", &key.0, &key.1, true).is_err());
    session.states.insert(
        key.clone(),
        (
            Outcome::new("available", ""),
            Instant::now() - std::time::Duration::from_secs(301),
        ),
    );
    assert!(begin_request(&mut session, "current", &key.0, &key.1, true).is_err());
    session
        .states
        .insert(key.clone(), (Outcome::new("available", ""), Instant::now()));
    assert!(begin_request(&mut session, "current", &key.0, &key.1, true).is_ok());
    assert!(begin_request(&mut session, "current", &key.0, &key.1, true).is_err());
    session
        .states
        .insert(key.clone(), (Outcome::new("available", ""), Instant::now()));
    assert!(begin_request(&mut session, "current", &key.0, &key.1, false).is_ok());
    assert_ne!(session.states[&key].0.status, "available");
}
async fn http_once(
    status: &str,
    body: &str,
    extra: &str,
) -> (String, tokio::task::JoinHandle<String>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1/activities", listener.local_addr().unwrap());
    let response = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\n{extra}Connection: close\r\n\r\n{body}", body.len());
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = vec![0; 8192];
        let n = socket.read(&mut buf).await.unwrap();
        socket.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8_lossy(&buf[..n]).into_owned()
    });
    (url, task)
}
#[tokio::test]
async fn native_source_priority_empty_remote_and_bad_remote_fallback() {
    let directory =
        std::env::temp_dir().join(format!("quotapeek-activities-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&directory).unwrap();
    let local = directory.join("activities.json");
    std::fs::write(
        &local,
        include_bytes!("../../tests/activity_mock/activities.json"),
    )
    .unwrap();
    let empty = r#"{"schemaVersion":2,"revision":"remote","activities":[]}"#;
    let (url, task) = http_once("200 OK", empty, "").await;
    let result = transport::load(&url, &local).await;
    assert_eq!(result.source.as_deref(), Some("server"));
    assert!(result.catalog.unwrap().activities.is_empty());
    let request = task.await.unwrap().to_lowercase();
    assert!(!request.contains("authorization:"));
    assert!(!request.contains("account"));
    for (status, body, extra) in [
        ("404 Not Found", "{}", ""),
        ("200 OK", "{", ""),
        ("302 Found", "", "Location: http://127.0.0.1:9/steal\r\n"),
    ] {
        let (url, task) = http_once(status, body, extra).await;
        let result = transport::load(&url, &local).await;
        assert_eq!(result.source.as_deref(), Some("local"));
        assert_eq!(result.catalog.unwrap().activities.len(), 2);
        task.await.unwrap();
    }
    std::fs::write(&local, "{").unwrap();
    assert!(transport::load("", &local).await.catalog.is_none());
    std::fs::remove_dir_all(directory).unwrap();
}
#[tokio::test]
async fn mock_cannot_send_credentials_even_with_valid_route() {
    let item = mock_catalog().activities.remove(0);
    let mut headers = HeaderMap::new();
    headers.insert("authorization", "Bearer sentinel".parse().unwrap());
    let result = engine::request(&item, &item.query, "preview-wb-0", &headers, false).await;
    assert_eq!(result.status, "unknown");
    assert!(result.note.contains("without credentials"));
}
#[tokio::test]
async fn configuration_errors_explain_missing_source_and_remote_failure() {
    let missing =
        std::env::temp_dir().join(format!("quotapeek-missing-{}.json", uuid::Uuid::new_v4()));
    let unset = transport::load("", &missing).await;
    assert!(unset
        .notice
        .unwrap()
        .contains("No configuration service URL is set"));
    let (url, task) = http_once("503 Service Unavailable", "{}", "").await;
    let failed = transport::load(&url, &missing).await;
    assert!(failed
        .notice
        .unwrap()
        .contains("Configuration service did not return a catalog"));
    task.await.unwrap();
}
#[tokio::test]
async fn loopback_configuration_ignores_system_proxy() {
    const CHILD_SOURCE: &str = "QUOTAPEEK_TEST_LOOPBACK_SOURCE";
    if let Ok(source) = std::env::var(CHILD_SOURCE) {
        let missing =
            std::env::temp_dir().join(format!("quotapeek-proxy-{}.json", uuid::Uuid::new_v4()));
        let loaded = transport::load(&source, &missing).await;
        assert_eq!(
            loaded.source.as_deref(),
            Some("server"),
            "{:?}",
            loaded.notice
        );
        return;
    }
    let (origin, origin_task) = http_once(
        "200 OK",
        r#"{"schemaVersion":2,"revision":"direct","activities":[]}"#,
        "",
    )
    .await;
    let (proxy, proxy_task) = http_once("503 Service Unavailable", "{}", "").await;
    let output = tokio::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "activities::tests::loopback_configuration_ignores_system_proxy",
            "--exact",
            "--nocapture",
        ])
        .env(CHILD_SOURCE, origin)
        .env("HTTP_PROXY", &proxy)
        .env("HTTPS_PROXY", &proxy)
        .env("ALL_PROXY", &proxy)
        .env("NO_PROXY", "")
        .output()
        .await
        .unwrap();
    origin_task.abort();
    proxy_task.abort();
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
#[tokio::test]
#[ignore = "Requires fresh configuration publisher :1431 and fake official API :1432; see tests/activity_mock/README.md"]
async fn activity_mock_end_to_end() {
    use tauri::Manager;
    let directory =
        std::env::temp_dir().join(format!("quotapeek-activity-e2e-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("activities.json");
    std::fs::write(
        &path,
        include_bytes!("../../tests/activity_mock/activities.json"),
    )
    .unwrap();
    let remote = transport::load("http://127.0.0.1:1431/v1/activities", &path).await;
    assert_eq!(remote.source.as_deref(), Some("server"));
    let local = transport::load("http://127.0.0.1:1431/missing", &path).await;
    assert_eq!(local.source.as_deref(), Some("local"));
    let cfg = local.catalog.unwrap();
    let wb = &cfg.activities[0];
    let zc = &cfg.activities[1];
    let headers = HeaderMap::new();
    assert_eq!(
        engine::execute(wb, "preview-wb-0", &headers, false)
            .await
            .status,
        "available"
    );
    assert_eq!(
        engine::execute(wb, "preview-wb-0", &headers, true)
            .await
            .status,
        "claimed"
    );
    assert_eq!(
        engine::execute(wb, "preview-wb-0", &headers, true)
            .await
            .status,
        "claimed"
    );
    assert_eq!(
        engine::execute(wb, "preview-wb-2", &headers, true)
            .await
            .status,
        "pending"
    );
    assert_eq!(
        engine::execute(zc, "preview-zc-1", &headers, true)
            .await
            .status,
        "verification"
    );
    assert_eq!(
        engine::execute(zc, "preview-zc-0", &headers, true)
            .await
            .status,
        "claimed"
    );

    let client = reqwest::Client::new();
    for fault in ["timeout", "malformed", "redirect"] {
        for (account, expected) in [("preview-wb-0", "claimed"), ("preview-wb-2", "pending")] {
            client
                .post("http://127.0.0.1:1432/testing/reset")
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap();
            let mut item = wb.clone();
            let claim = item.claim.as_mut().unwrap();
            claim.request.timeout_ms = 500;
            claim.request.query.insert("fault".into(), fault.into());
            assert_eq!(
                engine::execute(&item, account, &headers, true).await.status,
                expected,
                "{fault}: {account}"
            );
            assert_eq!(
                engine::execute(&item, account, &headers, true).await.status,
                expected
            );
            let counts: serde_json::Value = client
                .get("http://127.0.0.1:1432/testing/stats")
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            assert_eq!(
                counts["claims"], 1,
                "A lost response must never trigger a second submission"
            );
            assert_eq!(counts["redirects"], 0);
        }
    }
    for fault in ["malformed", "redirect"] {
        let mut item = wb.clone();
        item.query
            .request
            .query
            .insert("fault".into(), fault.into());
        assert_eq!(
            engine::execute(&item, "preview-wb-0", &headers, false)
                .await
                .status,
            "unknown"
        );
    }

    // Use a real Wry AppHandle and managed state, without windows or account storage.
    // This exercises the native commands and proves mock execution needs no credentials.
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(ActivityState::default())
        .build(context)
        .unwrap();
    let native_path = catalog::local_path(&std::env::current_exe().unwrap()).unwrap();
    struct RestoreFile(std::path::PathBuf, Option<Vec<u8>>);
    impl Drop for RestoreFile {
        fn drop(&mut self) {
            if let Some(bytes) = &self.1 {
                std::fs::write(&self.0, bytes).unwrap();
            } else {
                std::fs::remove_file(&self.0).unwrap();
            }
        }
    }
    let _restore = RestoreFile(native_path.clone(), std::fs::read(&native_path).ok());
    std::fs::write(
        &native_path,
        include_bytes!("../../tests/activity_mock/activities.json"),
    )
    .unwrap();
    let remote = activity_load_catalog(
        app.state(),
        "http://127.0.0.1:1431/v1/activities".into(),
        true,
    )
    .await
    .unwrap();
    assert_eq!(remote.source.as_deref(), Some("server"));
    let (empty_url, empty_task) = http_once(
        "200 OK",
        r#"{"schemaVersion":2,"revision":"empty","activities":[]}"#,
        "",
    )
    .await;
    let empty = activity_load_catalog(app.state(), empty_url, true)
        .await
        .unwrap();
    assert!(empty.catalog.unwrap().activities.is_empty());
    assert!(activity_execute(
        app.state(),
        app.handle().clone(),
        remote.session,
        wb.id.clone(),
        "preview-wb-0".into(),
        true
    )
    .await
    .is_err());
    empty_task.await.unwrap();

    for account in ["preview-wb-0", "preview-wb-2"] {
        client
            .post("http://127.0.0.1:1432/testing/reset")
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap();
        let mut native_cfg = cfg.clone();
        let claim = native_cfg.activities[0].claim.as_mut().unwrap();
        claim.request.timeout_ms = 500;
        claim.request.query.insert("fault".into(), "timeout".into());
        std::fs::write(&native_path, serde_json::to_vec(&native_cfg).unwrap()).unwrap();
        let loaded =
            activity_load_catalog(app.state(), "http://127.0.0.1:1431/missing".into(), true)
                .await
                .unwrap();
        assert_eq!(loaded.source.as_deref(), Some("local"));
        let execute = |claiming| {
            activity_execute(
                app.state(),
                app.handle().clone(),
                loaded.session.clone(),
                wb.id.clone(),
                account.into(),
                claiming,
            )
        };
        assert!(
            execute(true).await.is_err(),
            "Native commands require a fresh availability query"
        );
        assert_eq!(execute(false).await.unwrap().status, "available");
        let (first, duplicate) = tokio::join!(execute(true), execute(true));
        assert_eq!(
            first.unwrap().status,
            if account == "preview-wb-0" {
                "claimed"
            } else {
                "pending"
            }
        );
        assert!(
            duplicate.is_err(),
            "Concurrent claims must serialize and reject the duplicate"
        );
        assert!(execute(true).await.is_err());
        assert!(activity_execute(
            app.state(),
            app.handle().clone(),
            loaded.session.clone(),
            wb.id.clone(),
            "real-account".into(),
            false
        )
        .await
        .is_err());
        let counts: serde_json::Value = client
            .get("http://127.0.0.1:1432/testing/stats")
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(counts["claims"], 1);
        assert_eq!(counts["redirects"], 0);
    }
    std::fs::remove_dir_all(directory).unwrap();
}
