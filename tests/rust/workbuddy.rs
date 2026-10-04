use super::*;

#[test]
fn jwt_identity_reads_uid_and_nickname() {
    // {"uid":"u-1","nickname":"Neo","enterpriseId":"ent-9"}
    let payload = r#"{"uid":"u-1","nickname":"Neo","enterpriseId":"ent-9"}"#;
    let token = format!("h.{}.s", urlsafe_b64(payload.as_bytes().to_vec()));
    assert_eq!(jwt_identity(&token).0, "u-1");
    assert_eq!(jwt_identity(&token).1, "Neo");
    assert_eq!(jwt_identity(&token).2, "ent-9");
}

fn urlsafe_b64(bytes: Vec<u8>) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let buffer = (chunk[0] as u32) << 16
            | (*chunk.get(1).unwrap_or(&0) as u32) << 8
            | (*chunk.get(2).unwrap_or(&0) as u32);
        out.push(TABLE[(buffer >> 18) as usize & 63] as char);
        out.push(TABLE[(buffer >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(buffer >> 6) as usize & 63] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[buffer as usize & 63] as char);
        }
    }
    out
}

#[test]
fn cycle_metrics_win_and_derive_used() {
    let pkg = json!({"CycleCapacitySize":100,"CycleCapacityRemain":60,"CycleCapacityUsed":0});
    assert_eq!(package_remain_used(&pkg), (60.0, 40.0, 100.0));
    // Precise spellings win over the rounded ones: the site totals need the fractions.
    let explicit = json!({
        "CycleCapacitySize":100,"CycleCapacityRemain":80,"CycleCapacityUsed":50,
        "CycleCapacityRemainPrecise":"69.69","CycleCapacityUsedPrecise":"30.31"
    });
    let (remain, used, size) = package_remain_used(&explicit);
    assert!(
        (remain - 69.69).abs() < 1e-6 && (used - 30.31).abs() < 1e-6 && (size - 100.0).abs() < 1e-6
    );
}

#[test]
fn lifetime_metrics_back_the_cycle_free_shape() {
    let pkg = json!({"CapacitySize":100,"CapacityRemain":100,"CapacityUsed":0});
    assert_eq!(package_remain_used(&pkg), (100.0, 0.0, 100.0));
    let sizeless = json!({"CycleCapacityRemain":30,"CycleCapacityUsed":20});
    assert_eq!(package_remain_used(&sizeless), (30.0, 20.0, 50.0));
    let empty = json!({});
    assert_eq!(package_remain_used(&empty), (0.0, 0.0, 0.0));
}

#[test]
fn expiry_reads_all_reported_spellings() {
    // Real responses put the cycle window first, mirroring the site's 到期时间.
    assert_eq!(
        package_end_time(
            &json!({"CycleEndTime":"2026-09-30 23:59:59", "DeductionEndTime":2044672449000_u64})
        )
        .as_deref(),
        Some("2026-09-30 23:59:59")
    );
    // Without a cycle window the deduction cutoff in millis wins.
    let millis = package_end_time(
        &json!({"DeductionEndTime": 1793367204000_u64, "PackageEndTime":"2026-10-01 14:20:18"}),
    );
    assert!(millis.is_some());
    assert_eq!(
        package_end_time(&json!({"PackageEndTime":"2026-10-01 14:20:18"})).as_deref(),
        Some("2026-10-01 14:20:18")
    );
    assert_eq!(
        package_end_time(&json!({"ExpireTime":"0000-00-00 00:00:00"})),
        None
    );
    assert_eq!(package_end_time(&json!({})), None);
}

#[test]
fn accounts_keep_identity_when_tokens_rotate_and_separate_users() {
    let auth = StoredAuth {
        access_token: "old".into(),
        refresh_token: "refresh".into(),
        expires_at: 0,
        domain: "www.workbuddy.cn".into(),
        uid: "one".into(),
        nickname: "Same display name".into(),
        enterprise_id: String::new(),
    };
    let mut rotated = auth.clone();
    rotated.access_token = "new".into();
    assert_eq!(account_id(&auth), account_id(&rotated));
    rotated.uid = "two".into();
    assert_ne!(account_id(&auth), account_id(&rotated));
}

#[test]
fn snapshot_aggregates_packages_and_fills_used() {
    let stored = StoredAuth {
        access_token: String::new(),
        refresh_token: String::new(),
        expires_at: 0,
        domain: "www.codebuddy.cn".into(),
        uid: "u-1".into(),
        nickname: "Neo".into(),
        enterprise_id: String::new(),
    };
    let data = json!({
        "Response": {"Data": {"Accounts": [
            {"PackageName": "平台奖励积分", "CycleCapacitySize": 100, "CycleCapacityRemain": 100, "PackageEndTime": "2026-10-01 14:20:18"},
            {"PackageName": "体验包", "CapacitySize": 250, "CapacityRemain": 150}
        ]}}
    });
    let account = snapshot(&data, &stored);
    assert_eq!(account.packages.len(), 2);
    assert_eq!(account.total_remain, 250.0);
    assert_eq!(account.total_size, 350.0);
    assert_eq!(account.total_used, 100.0);
    assert_eq!(account.packages[0].name, "平台奖励积分");
    assert_eq!(
        account.packages[0].end_time.as_deref(),
        Some("2026-10-01 14:20:18")
    );
    assert_eq!(account.region, "cn");
}
