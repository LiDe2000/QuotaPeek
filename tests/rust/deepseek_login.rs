use super::*;
#[tokio::test]
#[ignore = "requires network; creates and immediately cancels an authorization attempt without signing in"]
async fn live_authorization_initialization() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client = client().ok().unwrap();
    let verifier = random().ok().unwrap();
    let redirect_uri = format!(
        "http://127.0.0.1:{}/oauth/callback",
        listener.local_addr().unwrap().port()
    );
    let init = auth(&client, "auth_init", json!({"code_challenge": URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())), "code_challenge_method":"S256", "state":random().ok().unwrap(), "redirect_uri":redirect_uri, "locale":"en_US", "login_source":"desktop"})).await;
    let init = init.unwrap_or_else(|failure| panic!("{}", failure.message));
    let cancel = auth(
        &client,
        "auth_cancel",
        json!({"authorize_id":init["authorize_id"], "code_verifier":verifier}),
    )
    .await;
    assert!(
        cancel.is_ok(),
        "Could not cancel the test authorization attempt"
    );
    assert!(browser_url(init["authorize_url"].as_str().unwrap(), "/dsh/authorize").is_ok());
}
#[test]
fn callback_rejects_wrong_state_duplicate_values_and_wrong_paths() {
    assert_eq!(
        callback("GET /oauth/callback?state=abc&code=one HTTP/1.1\r\n", "abc"),
        Some("one".into())
    );
    for target in [
        "/oauth/callback?state=bad&code=one",
        "/oauth/callback?state=abc&state=abc&code=one",
        "/oauth/callback?state=abc&code=one&code=two",
        "/wrong?state=abc&code=one",
    ] {
        assert!(callback(&format!("GET {target} HTTP/1.1"), "abc").is_none());
    }
}
#[test]
fn returned_browser_destinations_stay_on_the_platform() {
    assert!(browser_url(
        "https://platform.deepseek.com/dsh/authorize?state=abc",
        "/dsh/authorize"
    )
    .is_ok());
    for url in [
        "https://evil.example/dsh/authorize",
        "http://platform.deepseek.com/dsh/authorize",
        "https://platform.deepseek.com/other",
        "https://user@platform.deepseek.com/dsh/authorize",
    ] {
        assert!(browser_url(url, "/dsh/authorize").is_err());
    }
}
#[test]
fn summary_preserves_debt_and_separate_currencies() {
    let value = balances(json!({ "normal_wallets": [{"currency":"CNY","balance":"-0.0200000000000000"},{"currency":"USD","balance":"1.00"}], "bonus_wallets":[{"currency":"CNY","balance":"6.0000000000000000"}] })).ok().unwrap();
    assert_eq!(value[0].total_balance, "5.98");
    assert_eq!(value[0].topped_up_balance, "-0.02");
    assert_eq!(value[1].total_balance, "1");
    assert!(value[0].total_cost.is_none());
}
#[test]
fn summary_projects_cumulative_cost_by_currency_without_inventing_zero() {
    let value = balances(json!({
        "normal_wallets": [{"currency":"CNY","balance":"-0.02"}, {"currency":"USD","balance":"2"}],
        "bonus_wallets": [{"currency":"CNY","balance":"6"}],
        "total_costs": [{"currency":"CNY","amount":"1.005"}, {"currency":"CNY","amount":"0.005"}]
    })).ok().unwrap();
    assert_eq!(value[0].total_cost.as_deref(), Some("1.01"));
    assert!(value[1].total_cost.is_none());
    for amount in ["NaN", "-1"] {
        assert!(balances(json!({
            "normal_wallets": [{"currency":"CNY","balance":"1"}], "bonus_wallets": [],
            "total_costs": [{"currency":"CNY","amount":amount}]
        }))
        .is_err());
    }
}
#[test]
fn expired_sessions_and_business_errors_do_not_become_balances() {
    assert!(unwrap_payload(json!({"code":40003})).is_err());
    assert!(unwrap_payload(json!({"code":0,"data":{"biz_code":1,"biz_data":{}}})).is_err());
    assert!(profile(&json!({"email":"masked@example.com"})).is_err());
}
