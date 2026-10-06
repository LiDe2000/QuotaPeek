use super::*;

#[test]
fn local_success_does_not_open_a_web_page() {
    let result = open_with_fallback(
        Provider::Deepseek,
        &[1],
        |_| Ok(()),
        |_| panic!("unexpected fallback"),
    )
    .unwrap();
    assert_eq!(result.destination, "local");
    assert_eq!(result.reason, None);
}

#[test]
fn missing_app_and_failed_launch_open_the_correct_fallback() {
    for (provider, expected_url) in [
        (Provider::Codex, "https://chatgpt.com/"),
        (Provider::Deepseek, "https://www.deepseek.com/en/harness/"),
        (Provider::Workbuddy, "https://www.workbuddy.cn/app"),
        (Provider::Zcode, "https://zcode.z.ai/"),
    ] {
        let mut opened = String::new();
        let missing = open_with_fallback::<u8>(
            provider,
            &[],
            |_| unreachable!(),
            |url| {
                opened = url.into();
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(opened, expected_url);
        assert_eq!(missing.reason, Some("not-installed"));
        assert_eq!(missing.download, provider == Provider::Zcode);
        let failed =
            open_with_fallback(provider, &[1], |_| Err("failed".into()), |_| Ok(())).unwrap();
        assert_eq!(failed.reason, Some("launch-failed"));
    }
}

#[test]
fn a_later_valid_installation_wins_before_web_fallback() {
    let result = open_with_fallback(
        Provider::Zcode,
        &[false, true],
        |valid| {
            if *valid {
                Ok(())
            } else {
                Err("stale installation".into())
            }
        },
        |_| panic!("unexpected fallback"),
    )
    .unwrap();
    assert_eq!(result.destination, "local");
}

#[test]
fn browser_failure_is_reported_and_unknown_providers_are_rejected() {
    assert!(open_with_fallback::<u8>(
        Provider::Codex,
        &[],
        |_| unreachable!(),
        |_| Err("browser failed".into())
    )
    .is_err());
    assert!(serde_json::from_str::<Provider>("\"unknown\"").is_err());
    assert!(serde_json::from_str::<Provider>("\"https://example.com\"").is_err());
}

#[cfg(windows)]
#[test]
fn discovery_rejects_cli_wrappers_and_unrelated_executables() {
    assert!(valid_app_id(
        Provider::Codex,
        "OpenAI.Codex_2p2nqsd0c76g0!App"
    ));
    assert!(!valid_app_id(
        Provider::Codex,
        "OpenAI.Codex_2p2nqsd0c76g0!CodexCoreCommandRunner"
    ));
    assert!(!valid_app_id(
        Provider::Zcode,
        "OpenAI.Codex_2p2nqsd0c76g0!App"
    ));
    assert!(!valid_app_id(
        Provider::Codex,
        "OpenAI.Codex_test!App;cmd.exe"
    ));
    assert!(!valid_executable(
        Provider::Codex,
        std::path::Path::new(r"C:\App\bin\codex.exe")
    ));
    assert!(!valid_executable(
        Provider::Codex,
        std::path::Path::new(r"C:\App\codex.cmd")
    ));
    assert!(!valid_executable(
        Provider::Deepseek,
        std::path::Path::new(r"C:\App\DeepSeek.exe")
    ));
    assert!(!valid_executable(
        Provider::Zcode,
        std::path::Path::new(r"C:\App\Uninstall ZCode.exe")
    ));
    assert!(!valid_executable(
        Provider::Workbuddy,
        std::path::Path::new("WorkBuddy.exe")
    ));
}
