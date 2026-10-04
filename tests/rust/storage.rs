use super::*;
use serde_json::json;

#[test]
fn activity_service_url_survives_reopen() {
    let directory = temp_root();
    let path = directory.join("quotapeek.db");
    {
        let db = Database::open(&path).unwrap();
        db.save_settings(
            &[(
                "quotapeek-activity-service-url".into(),
                "https://activities.example/v1/activities".into(),
            )]
            .into(),
        )
        .unwrap();
    }
    let db = Database::open(&path).unwrap();
    let state = db.load_state().unwrap();
    assert_eq!(
        state.settings["quotapeek-activity-service-url"],
        "https://activities.example/v1/activities"
    );
    drop(db);
    std::fs::remove_dir_all(directory).unwrap();
}

fn temp_root() -> PathBuf {
    std::env::temp_dir().join(format!("quotapeek-sqlite-{}", uuid::Uuid::new_v4()))
}

#[test]
fn provider_order_survives_reopening_database() {
    let root = temp_root();
    let path = root.join("quotapeek.db");
    let order = "[\"deepseek\",\"codex\",\"workbuddy\",\"zcode\"]";
    {
        let db = Database::open(&path).unwrap();
        db.save_settings(&[("quotapeek-provider-order-v1".into(), order.into())].into())
            .unwrap();
    }
    let db = Database::open(&path).unwrap();
    assert_eq!(
        db.load_state().unwrap().settings["quotapeek-provider-order-v1"],
        order
    );
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn removal_deletes_credentials_and_cache_and_repairs_selection_across_restarts() {
    let root = temp_root();
    let path = root.join("quotapeek.db");
    let removed = json!({"id":"w1","providerId":"workbuddy","fetchedAt":42});
    let kept = json!({"id":"w2","providerId":"workbuddy","fetchedAt":42});
    let patch: BTreeMap<String, String> = [
        ("quotapeek-selected-account".into(), "w2".into()),
        (
            "quotapeek-provider-selection-v1".into(),
            "{\"workbuddy\":\"w2\"}".into(),
        ),
    ]
    .into();
    {
        let db = Database::open(&path).unwrap();
        db.save_cache(&[removed, kept.clone()]).unwrap();
        db.connection.lock().unwrap().execute("INSERT INTO credentials(account_id,protection,payload) VALUES ('w1','fixture',X'01'),('w2','fixture',X'02')", []).unwrap();
        db.save_settings(
            &[
                ("quotapeek-theme".into(), "light".into()),
                ("quotapeek-selected-account".into(), "w1".into()),
            ]
            .into(),
        )
        .unwrap();
        db.remove_account("w1", &patch).unwrap();
        assert!(db
            .credential::<Value>("workbuddy", Some("w1"))
            .unwrap()
            .is_none());
        assert_eq!(
            db.list::<Value>("workbuddy")
                .unwrap()
                .iter()
                .map(|a| a.id.as_str())
                .collect::<Vec<_>>(),
            vec!["w2"]
        );
    }
    let db = Database::open(&path).unwrap();
    let saved = db.load_state().unwrap();
    assert_eq!(saved.accounts, vec![kept]);
    assert_eq!(saved.settings["quotapeek-selected-account"], "w2");
    assert_eq!(saved.settings["quotapeek-theme"], "light");
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_removal_rolls_back_account_credentials_cache_and_settings() {
    let root = temp_root();
    let db = Database::open(&root.join("quotapeek.db")).unwrap();
    let account = json!({"id":"codex-local","providerId":"codex","fetchedAt":42});
    db.save_cache(std::slice::from_ref(&account)).unwrap();
    db.connection.lock().unwrap().execute("INSERT INTO credentials(account_id,protection,payload) VALUES ('codex-local','fixture',X'01')", []).unwrap();
    db.save_settings(&[("quotapeek-selected-account".into(), "codex-local".into())].into())
        .unwrap();
    db.connection.lock().unwrap().execute_batch("CREATE TRIGGER refuse_selection BEFORE INSERT ON settings BEGIN SELECT RAISE(ABORT,'fixture: disk full'); END;").unwrap();
    let patch = [("quotapeek-selected-account".into(), "".into())].into();
    assert!(db.remove_account("codex-local", &patch).is_err());
    assert_eq!(db.load_state().unwrap().accounts, vec![account]);
    assert_eq!(db.list::<Value>("codex").unwrap().len(), 1);
    assert_eq!(
        db.load_state().unwrap().settings["quotapeek-selected-account"],
        "codex-local"
    );
    assert!(db
        .remove_account(
            "codex-local",
            &[("quotapeek-theme".into(), "dark".into())].into()
        )
        .is_err());
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn portable_paths_follow_exe_and_installed_paths_follow_user_data() {
    assert_eq!(
        data_root(
            Path::new("C:/Apps/QuotaPeek/quotapeek.exe"),
            Path::new("C:/User/AppData/QuotaPeek"),
            false
        )
        .unwrap(),
        PathBuf::from("C:/Apps/QuotaPeek/data")
    );
    assert_eq!(
        data_root(
            Path::new("C:/Apps/QuotaPeek/quotapeek.exe"),
            Path::new("C:/User/AppData/QuotaPeek"),
            true
        )
        .unwrap(),
        PathBuf::from("C:/User/AppData/QuotaPeek")
    );
}

#[test]
fn settings_and_cache_survive_reopen_and_folder_move() {
    let root = temp_root();
    let path = root.join("data/quotapeek.db");
    let account =
        json!({"id":"codex-local", "providerId":"codex", "fetchedAt":42, "rateLimits":{}});
    {
        let db = Database::open(&path).unwrap();
        db.save_settings(&[("quotapeek-theme".into(), "light".into())].into())
            .unwrap();
        db.save_cache(std::slice::from_ref(&account)).unwrap();
    }
    let moved = root.with_extension("moved");
    std::fs::rename(&root, &moved).unwrap();
    let db = Database::open(&moved.join("data/quotapeek.db")).unwrap();
    let state = db.load_state().unwrap();
    assert_eq!(state.settings["quotapeek-theme"], "light");
    assert_eq!(state.accounts, vec![account]);
    assert_eq!(
        db.connection
            .lock()
            .unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        CURRENT_VERSION
    );
    drop(db);
    std::fs::remove_dir_all(moved).unwrap();
}

#[test]
fn upgrades_existing_database_once_and_backs_up_before_changes() {
    let root = temp_root();
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("quotapeek.db");
    {
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &MIGRATIONS[..1]).unwrap();
        conn.execute(
            "INSERT INTO settings(key,value) VALUES ('quotapeek-theme','classic')",
            [],
        )
        .unwrap();
    }
    for _ in 0..2 {
        let db = Database::open(&path).unwrap();
        assert_eq!(
            db.load_state().unwrap().settings["quotapeek-theme"],
            "classic"
        );
        assert_eq!(
            db.connection
                .lock()
                .unwrap()
                .query_row("SELECT count(*) FROM schema_migrations", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            CURRENT_VERSION
        );
    }
    let backup = Connection::open(path.with_extension("db.v1.bak")).unwrap();
    assert_eq!(
        backup
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        backup
            .query_row(
                "SELECT value FROM settings WHERE key='quotapeek-theme'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "classic"
    );
    drop(backup);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_upgrade_rolls_back_schema_and_version() {
    let mut conn = Connection::open_in_memory().unwrap();
    let broken = [
        "CREATE TABLE first(id INTEGER);",
        "CREATE TABLE second(id INTEGER); INVALID SQL;",
    ];
    assert!(migrate(&mut conn, &broken).is_err());
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(conn.query_row("SELECT count(*) FROM sqlite_master WHERE name IN ('first','second','schema_migrations')", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
}

#[test]
fn newer_database_is_rejected_without_changing_saved_data() {
    let root = temp_root();
    let path = root.join("quotapeek.db");
    {
        let db = Database::open(&path).unwrap();
        db.save_settings(&[("quotapeek-theme".into(), "light".into())].into())
            .unwrap();
    }
    {
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", CURRENT_VERSION + 1)
            .unwrap();
    }
    assert!(Database::open(&path).err().unwrap().contains("newer"));
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT value FROM settings WHERE key='quotapeek-theme'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "light"
    );
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn invalid_cache_batch_is_atomic_and_cannot_replace_a_newer_snapshot() {
    let root = temp_root();
    let db = Database::open(&root.join("quotapeek.db")).unwrap();
    let first = json!({"id":"a", "providerId":"codex", "fetchedAt":42, "rateLimits":{}});
    db.save_cache(std::slice::from_ref(&first)).unwrap();
    assert!(db
        .save_cache(&[
            json!({"id":"b","providerId":"codex","fetchedAt":50}),
            json!({"id":"broken"})
        ])
        .is_err());
    db.save_cache(&[
        json!({"id":"a","providerId":"codex","fetchedAt":10,"rateLimits":{"old":true}}),
    ])
    .unwrap();
    assert_eq!(db.load_state().unwrap().accounts, vec![first]);
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn credentials_are_encrypted_and_reauthorization_preserves_identity_and_order() {
    let root = temp_root();
    let path = root.join("quotapeek.db");
    let db = Database::open(&path).unwrap();
    let first = json!({"apiKey":"synthetic-test-secret-one", "label":"First"});
    db.upsert("deepseek-api", "a", &first).unwrap();
    db.upsert(
        "deepseek-api",
        "b",
        &json!({"apiKey":"synthetic-test-secret-two", "label":"Second"}),
    )
    .unwrap();
    db.upsert(
        "deepseek-api",
        "a",
        &json!({"apiKey":"synthetic-test-secret-rotated", "label":"Renamed"}),
    )
    .unwrap();
    let entries = db.list::<Value>("deepseek-api").unwrap();
    assert_eq!(
        entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
        vec!["a", "b"]
    );
    assert_eq!(entries[0].auth["label"], "Renamed");
    assert_eq!(entries[0].auth["apiKey"], "");
    assert_eq!(
        db.credential::<Value>("deepseek-api", Some("a"))
            .unwrap()
            .unwrap()
            .auth["apiKey"],
        "synthetic-test-secret-rotated"
    );
    // Simulate credentials that cannot be decrypted by this computer/user.
    db.connection
        .lock()
        .unwrap()
        .execute(
            "UPDATE credentials SET payload=x'00' WHERE account_id='a'",
            [],
        )
        .unwrap();
    assert!(db
        .credential::<Value>("deepseek-api", Some("a"))
        .err()
        .unwrap()
        .contains("Reconnect"));
    assert_eq!(db.list::<Value>("deepseek-api").unwrap().len(), 2);
    assert_eq!(
        db.credential::<Value>("deepseek-api", Some("b"))
            .unwrap()
            .unwrap()
            .auth["apiKey"],
        "synthetic-test-secret-two"
    );
    db.upsert("deepseek-api", "a", &first).unwrap();
    assert_eq!(
        db.credential::<Value>("deepseek-api", Some("a"))
            .unwrap()
            .unwrap()
            .auth,
        first
    );
    drop(db);
    let bytes = std::fs::read(&path).unwrap();
    assert!(!bytes
        .windows(b"synthetic-test-secret".len())
        .any(|window| window == b"synthetic-test-secret"));
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn credential_write_failure_rolls_back_account_metadata() {
    let root = temp_root();
    let db = Database::open(&root.join("quotapeek.db")).unwrap();
    let auth = json!({"label":"Original","token":"synthetic-test-secret"});
    db.upsert("deepseek-platform", "a", &auth).unwrap();
    db.connection.lock().unwrap().execute_batch("CREATE TRIGGER reject_credentials BEFORE INSERT ON credentials BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(db
        .upsert(
            "deepseek-platform",
            "a",
            &json!({"label":"Changed","token":"new"})
        )
        .is_err());
    assert_eq!(
        db.list::<Value>("deepseek-platform").unwrap()[0].auth["label"],
        "Original"
    );
    assert!(db.upsert("deepseek-platform", "b", &auth).is_err());
    assert_eq!(db.list::<Value>("deepseek-platform").unwrap().len(), 1);
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn device_ids_survive_restarts_and_are_not_overwritten_by_ui_settings() {
    let root = temp_root();
    let path = root.join("quotapeek.db");
    let db = Database::open(&path).unwrap();
    assert_eq!(
        db.setting_or_insert("device.deepseek", "first").unwrap(),
        "first"
    );
    assert_eq!(
        db.setting_or_insert("device.deepseek", "second").unwrap(),
        "first"
    );
    assert!(db
        .save_settings(
            &[
                ("quotapeek-theme".into(), "light".into()),
                ("device.deepseek".into(), "changed".into())
            ]
            .into()
        )
        .is_err());
    assert!(db.load_state().unwrap().settings.is_empty());
    drop(db);
    let db = Database::open(&path).unwrap();
    assert_eq!(
        db.setting_or_insert("device.deepseek", "third").unwrap(),
        "first"
    );
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn future_cache_format_is_skipped_until_a_fresh_query_replaces_it() {
    let root = temp_root();
    let db = Database::open(&root.join("quotapeek.db")).unwrap();
    let account = json!({"id":"a", "providerId":"codex", "fetchedAt":42, "rateLimits":{}});
    db.save_cache(&[account]).unwrap();
    db.connection
        .lock()
        .unwrap()
        .execute("UPDATE quota_cache SET format_version=2", [])
        .unwrap();
    assert!(db.load_state().unwrap().accounts.is_empty());
    let refreshed = json!({"id":"a", "providerId":"codex", "fetchedAt":43, "rateLimits":{}});
    db.save_cache(std::slice::from_ref(&refreshed)).unwrap();
    assert_eq!(db.load_state().unwrap().accounts, vec![refreshed]);
    drop(db);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn unrelated_database_and_unwritable_data_directory_are_rejected() {
    let root = temp_root();
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("unrelated.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('preserve');",
        )
        .unwrap();
    }
    assert!(Database::open(&path)
        .err()
        .unwrap()
        .contains("does not belong"));
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row("SELECT value FROM unrelated", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "preserve"
    );
    drop(conn);
    std::fs::write(root.join("blocked"), b"file").unwrap();
    assert!(Database::open(&root.join("blocked/quotapeek.db"))
        .err()
        .unwrap()
        .contains("writable"));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn an_incomplete_existing_backup_blocks_upgrade_without_touching_the_database() {
    let root = temp_root();
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("quotapeek.db");
    {
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &MIGRATIONS[..1]).unwrap();
    }
    std::fs::write(path.with_extension("db.v1.bak"), b"incomplete backup").unwrap();
    assert!(Database::open(&path).err().unwrap().contains("backup"));
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    drop(conn);
    std::fs::remove_dir_all(root).unwrap();
}
