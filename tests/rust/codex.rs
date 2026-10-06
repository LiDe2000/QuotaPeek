use super::*;
fn account() -> Value {
    json!({"account":{"type":"chatgpt","email":"test@example.com","planType":"plus"}})
}

fn missing_reset_details() -> Value {
    json!({"accountId":"account-1","rateLimits":{"primary":{"usedPercent":42}},"rateLimitResetCredits":{"availableCount":2,"credits":null}})
}

#[tokio::test]
async fn reset_retry_recovers_details_and_uses_the_fresh_count_and_quota() {
    let fresh = json!({"accountId":"account-1","rateLimits":{"primary":{"usedPercent":45}},"rateLimitResetCredits":{"availableCount":1,"credits":[{"id":"credit-1","resetType":"codexRateLimits","status":"available","expiresAt":2000000000}]}});
    let result = complete_reset_details(missing_reset_details(), async { Ok(fresh) }).await;
    let result = snapshot(&account(), result).unwrap();
    assert_eq!(
        result.rate_limits["codex"]
            .primary
            .as_ref()
            .unwrap()
            .used_percent,
        45.0
    );
    let resets = result.rate_limit_reset_credits.unwrap();
    assert_eq!(resets.available_count, 1);
    assert_eq!(resets.credits.unwrap()[0].id, "credit-1");
}

#[tokio::test]
async fn reset_retry_failure_keeps_the_successful_initial_snapshot() {
    let first = missing_reset_details();
    let result = complete_reset_details(first.clone(), async {
        Err(error("rate_limited", "Too many requests"))
    })
    .await;
    assert_eq!(result, first);
    assert!(snapshot(&account(), result).is_ok());
}

#[tokio::test]
async fn reset_retry_rejects_other_accounts_and_malformed_snapshots() {
    for fresh in [
        json!({"accountId":"account-2","rateLimits":{},"rateLimitResetCredits":{"availableCount":0,"credits":[]}}),
        json!({"accountId":"account-1","rateLimits":{"primary":{}},"rateLimitResetCredits":{"availableCount":0}}),
    ] {
        let first = missing_reset_details();
        assert_eq!(
            complete_reset_details(first.clone(), async { Ok(fresh) }).await,
            first
        );
    }
}

#[tokio::test]
async fn reset_retry_skips_zero_unknown_empty_complete_and_capped_details() {
    for reset in [
        Value::Null,
        json!({"availableCount":0,"credits":null}),
        json!({"availableCount":2,"credits":[]}),
        json!({"availableCount":1,"credits":[{"id":"credit-1","resetType":"codexRateLimits","status":"available"}]}),
        json!({"availableCount":2,"credits":[{"id":"credit-1","resetType":"codexRateLimits","status":"available"}]}),
    ] {
        let first = json!({"rateLimits":{},"rateLimitResetCredits":reset});
        let result =
            complete_reset_details(first.clone(), async { panic!("unexpected retry") }).await;
        assert_eq!(result, first);
    }
}

#[tokio::test]
async fn reset_retry_accepts_zero_and_stops_even_if_details_are_still_missing() {
    for reset in [
        json!({"availableCount":0,"credits":[]}),
        json!({"availableCount":1,"credits":null}),
    ] {
        let fresh = json!({"accountId":"account-1","rateLimits":{},"rateLimitResetCredits":reset});
        assert_eq!(
            complete_reset_details(missing_reset_details(), async { Ok(fresh.clone()) }).await,
            fresh
        );
    }
}

#[tokio::test]
async fn reset_retry_timeout_keeps_initial_quota_and_returns_within_its_budget() {
    let first = missing_reset_details();
    let result = tokio::time::timeout(
        Duration::from_secs(7),
        complete_reset_details(first.clone(), std::future::pending()),
    )
    .await
    .expect("optional retry must not stall the quota query");
    assert_eq!(result, first);
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
