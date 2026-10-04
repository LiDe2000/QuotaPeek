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
#[test]
fn preserves_reset_credit_count_even_without_all_details() {
    for credits in [
        Value::Null,
        json!([]),
        json!([{"id":"credit-1","resetType":"codexRateLimits","status":"available","expiresAt":2000000000}]),
    ] {
        let result = snapshot(
            &account(),
            json!({"rateLimits":{},"rateLimitResetCredits":{"availableCount":2,"credits":credits}}),
        )
        .unwrap();
        let reset = result.rate_limit_reset_credits.unwrap();
        assert_eq!(reset.available_count, 2);
        assert_eq!(
            reset.credits.as_ref().map(Vec::len),
            credits.as_array().map(Vec::len)
        );
        if let Some(detail) = reset.credits.as_ref().and_then(|rows| rows.first()) {
            assert_eq!(detail.id, "credit-1");
            assert_eq!(detail.expires_at, Some(2000000000));
        }
    }
    for value in [
        json!({"rateLimits":{}}),
        json!({"rateLimits":{},"rateLimitResetCredits":null}),
    ] {
        assert!(snapshot(&account(), value)
            .unwrap()
            .rate_limit_reset_credits
            .is_none());
    }
    let result = snapshot(
        &account(),
        json!({"rateLimits":{},"rateLimitResetCredits":{"availableCount":0,"credits":[]}}),
    )
    .unwrap();
    assert_eq!(result.rate_limit_reset_credits.unwrap().available_count, 0);
}
#[test]
fn usage_summary_reads_lifetime_and_current_date_bucket() {
    let today = "2026-09-15";
    let usage = token_usage(json!({"summary":{"lifetimeTokens":1234567},"dailyUsageBuckets":[{"startDate":today,"tokens":34567}]}), today).unwrap();
    assert_eq!(usage.lifetime_tokens, Some(1_234_567));
    assert_eq!(usage.today_tokens, Some(34_567));
    let empty_today = token_usage(
        json!({"summary":{"lifetimeTokens":10},"dailyUsageBuckets":[]}),
        today,
    )
    .unwrap();
    assert_eq!(empty_today.today_tokens, None);
    let latest_yesterday = token_usage(json!({"summary":{"lifetimeTokens":10},"dailyUsageBuckets":[{"startDate":"2026-09-14","tokens":9}]}), today).unwrap();
    assert_eq!(latest_yesterday.today_tokens, None);
    assert_eq!(
        latest_yesterday.latest_daily_date.as_deref(),
        Some("2026-09-14")
    );
    assert_eq!(latest_yesterday.latest_daily_tokens, Some(9));
    let dates_without_summary = token_usage(json!({"summary":{"lifetimeTokens":null},"dailyUsageBuckets":[{"startDate":"2026-09-14","tokens":9}]}), today).unwrap();
    assert_eq!(
        dates_without_summary.latest_daily_date.as_deref(),
        Some("2026-09-14")
    );
    let missing_daily = token_usage(
        json!({"summary":{"lifetimeTokens":10},"dailyUsageBuckets":null}),
        today,
    )
    .unwrap();
    assert_eq!(missing_daily.today_tokens, None);
    assert!(token_usage(
        json!({"summary":{"lifetimeTokens":null},"dailyUsageBuckets":null}),
        today
    )
    .is_none());
}
#[tokio::test]
#[ignore = "requires a signed-in local Codex installation and network"]
async fn live_codex_query() {
    let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let result = query(&date).await.unwrap();
    assert_eq!(result.provider_id, "codex");
    assert!(!result.rate_limits.is_empty());
    println!(
        "Codex query succeeded; {} quota buckets; token activity available: {}",
        result.rate_limits.len(),
        result.token_usage.is_some()
    );
    println!(
        "Reset credits: {:?}",
        result
            .rate_limit_reset_credits
            .as_ref()
            .map(|reset| (reset.available_count, reset.credits.as_ref().map(Vec::len)))
    );
}
