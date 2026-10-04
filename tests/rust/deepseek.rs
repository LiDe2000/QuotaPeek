use super::*;
#[test]
fn refresh_time_uses_unix_seconds_for_both_account_sources() {
    let before = chrono::Utc::now().timestamp();
    let fetched_at = now_secs();
    let after = chrono::Utc::now().timestamp();
    assert!((before..=after).contains(&fetched_at));
    let api = snapshot(
        "api".into(),
        "API".into(),
        Response {
            is_available: false,
            balance_infos: vec![],
        },
        fetched_at,
    );
    let platform = platform_snapshot(
        "platform".into(),
        "Platform".into(),
        None,
        vec![],
        fetched_at,
    );
    for account in [api, platform] {
        let json = serde_json::to_value(account).unwrap();
        assert_eq!(json["fetchedAt"].as_i64(), Some(fetched_at));
    }
}
#[test]
fn accepts_zero_balance_and_preserves_currencies_and_precision() {
    let value: Response = serde_json::from_str(r#"{"is_available":false,"balance_infos":[{"currency":"CNY","total_balance":"0.0000","granted_balance":"0","topped_up_balance":"0"},{"currency":"USD","total_balance":"1.123456","granted_balance":"0","topped_up_balance":"1.123456"}]}"#).unwrap();
    let value = validate(value).ok().unwrap();
    assert!(!value.is_available);
    assert_eq!(value.balance_infos[1].total_balance, "1.123456");
    let json = serde_json::to_string(&snapshot("id".into(), "Personal".into(), value, 1)).unwrap();
    assert!(!json.contains("apiKey"));
}
#[test]
fn rejects_invalid_amounts_and_empty_payload() {
    for amount in ["NaN", "1.2.3", ""] {
        assert!(validate(Response {
            is_available: true,
            balance_infos: vec![Balance {
                currency: "CNY".into(),
                total_balance: amount.into(),
                granted_balance: "0".into(),
                topped_up_balance: "0".into(),
                total_cost: None,
            }]
        })
        .is_err());
    }
    assert!(validate(Response {
        is_available: true,
        balance_infos: vec![]
    })
    .is_err());
}
