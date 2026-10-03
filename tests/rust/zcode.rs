use super::*;
use serde_json::json;

fn auth_for(provider: &str) -> StoredAuth {
    StoredAuth {
        identity: String::new(),
        zcode_jwt_token: "jwt".into(),
        access_token: "access".into(),
        provider: provider.into(),
        label: "LiDe".into(),
        site: String::new(),
        email: String::new(),
    }
}

#[test]
fn identity_separates_same_name_accounts_and_survives_token_rotation() {
    let first = credential_from_poll(&json!({"token": "old", "user": {"name": "Same", "user_id": "one"}}), SITE_ZAI).unwrap();
    let rotated = credential_from_poll(&json!({"token": "new", "user": {"name": "Renamed", "user_id": "one"}}), SITE_ZAI).unwrap();
    let other = credential_from_poll(&json!({"token": "old", "user": {"name": "Same", "user_id": "two"}}), SITE_ZAI).unwrap();
    assert_eq!(account_id(&first), account_id(&rotated));
    assert_ne!(account_id(&first), account_id(&other));
    let cn = credential_from_poll(&json!({"token": "old", "user": {"user_id": "one"}}), SITE_BIGMODEL).unwrap();
    assert_ne!(account_id(&first), account_id(&cn));
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
    assert_eq!(account.id, account_id(&auth_for(SITE_BIGMODEL)));
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
