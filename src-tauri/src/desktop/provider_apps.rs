use serde::{Deserialize, Serialize};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Codex,
    Workbuddy,
    Zcode,
    Deepseek,
}

impl Provider {
    fn web_url(self) -> &'static str {
        match self {
            Self::Codex => "https://chatgpt.com/",
            Self::Workbuddy => "https://www.workbuddy.cn/app",
            Self::Zcode => "https://zcode.z.ai/",
            Self::Deepseek => "https://chat.deepseek.com/",
        }
    }

    #[cfg(windows)]
    fn executable(self) -> &'static str {
        match self {
            Self::Codex => "Codex.exe",
            Self::Workbuddy => "WorkBuddy.exe",
            Self::Zcode => "ZCode.exe",
            Self::Deepseek => "DeepSeek Harness.exe",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct LaunchResult {
    destination: &'static str,
    reason: Option<&'static str>,
    download: bool,
}

fn open_with_fallback<T>(
    provider: Provider,
    candidates: &[T],
    mut launch: impl FnMut(&T) -> Result<(), String>,
    mut open_web: impl FnMut(&str) -> Result<(), String>,
) -> Result<LaunchResult, String> {
    for candidate in candidates {
        if launch(candidate).is_ok() {
            return Ok(LaunchResult {
                destination: "local",
                reason: None,
                download: false,
            });
        }
    }
    open_web(provider.web_url()).map_err(|_| {
        "Could not open the app or its official web page. Please retry.".to_string()
    })?;
    Ok(LaunchResult {
        destination: "web",
        reason: Some(if candidates.is_empty() {
            "not-installed"
        } else {
            "launch-failed"
        }),
        download: provider == Provider::Zcode,
    })
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct NativeTarget {
    provider: Provider,
    path: Option<String>,
    app_id: Option<String>,
}

#[cfg(windows)]
fn valid_executable(provider: Provider, path: &std::path::Path) -> bool {
    path.is_absolute()
        && path.file_name().is_some_and(|name| name.eq_ignore_ascii_case(provider.executable()))
        // Codex ships a CLI with the same filename. Never open a terminal instead of the desktop app.
        && !(provider == Provider::Codex
            && path.components().any(|part| part.as_os_str().eq_ignore_ascii_case("bin")))
        && path.is_file()
}

#[cfg(windows)]
fn valid_app_id(provider: Provider, id: &str) -> bool {
    provider == Provider::Codex
        && id.starts_with("OpenAI.Codex_")
        && id.split_once('!').is_some_and(|(family, app)| {
            !family.is_empty()
                && app == "App"
                && family
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._".contains(c))
                && app.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')
        })
}

#[cfg(windows)]
async fn discover(provider: Provider) -> Vec<NativeTarget> {
    use std::process::Stdio;
    let Some(system) = std::env::var_os("SystemRoot") else {
        return Vec::new();
    };
    // Use the system runtime and a fixed read-only script; no frontend paths or shell commands.
    let mut command = tokio::process::Command::new(
        std::path::PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
    );
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        include_str!("provider_apps.ps1"),
    ]);
    command
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(std::time::Duration::from_secs(8), command.output()).await;
    let Ok(Ok(output)) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let mut targets = Vec::new();
    for target in serde_json::from_slice::<Vec<NativeTarget>>(&output.stdout).unwrap_or_default() {
        if target.provider != provider || targets.contains(&target) {
            continue;
        }
        let valid = match (&target.path, &target.app_id) {
            (Some(path), None) => valid_executable(provider, std::path::Path::new(path)),
            (None, Some(id)) => valid_app_id(provider, id),
            _ => false,
        };
        if valid {
            targets.push(target)
        }
    }
    targets
}

#[cfg(not(windows))]
async fn discover(_provider: Provider) -> Vec<NativeTarget> {
    // Native discovery currently targets Windows. Other platforms use the official web page.
    Vec::new()
}

#[cfg(windows)]
fn launch(target: &NativeTarget) -> Result<(), String> {
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
    };
    let mut command = if let Some(path) = &target.path {
        if !valid_executable(target.provider, std::path::Path::new(path)) {
            return Err("App no longer installed".into());
        }
        let mut command = Command::new(path);
        if let Some(directory) = std::path::Path::new(path).parent() {
            command.current_dir(directory);
        }
        command
    } else if let Some(id) = &target.app_id {
        if !valid_app_id(target.provider, id) {
            return Err("Invalid app ID".into());
        }
        return activate_store_app(id);
    } else {
        return Err("Missing launch target".into());
    };
    command
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|_| "App launch failed".to_string())?;
    // Catch immediate loader/startup failures. Successful single-instance forwarding may exit zero.
    for _ in 0..5 {
        match child.try_wait() {
            Ok(Some(status)) if !status.success() => return Err("App exited during launch".into()),
            Ok(Some(_)) => return Ok(()),
            Err(_) => return Err("Could not check app launch".into()),
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
        }
    }
    Ok(())
}

#[cfg(windows)]
fn activate_store_app(id: &str) -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_LOCAL_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{
                ApplicationActivationManager, IApplicationActivationManager, AO_NOERRORUI,
            },
        },
    };
    // Activation reports Windows launch errors directly, unlike merely spawning explorer.exe.
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|_| "Could not initialize app activation".to_string())?;
        let result = (|| {
            let manager: IApplicationActivationManager =
                CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER)
                    .map_err(|_| "Could not access app activation".to_string())?;
            let wide: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
            manager
                .ActivateApplication(PCWSTR(wide.as_ptr()), PCWSTR::null(), AO_NOERRORUI)
                .map(|_| ())
                .map_err(|_| "App activation failed".to_string())
        })();
        CoUninitialize();
        result
    }
}

#[cfg(not(windows))]
fn launch(_target: &NativeTarget) -> Result<(), String> {
    Err("Native launch unavailable".into())
}

#[tauri::command]
pub async fn open_provider_app(
    app: tauri::AppHandle,
    provider: Provider,
) -> Result<LaunchResult, String> {
    let targets = discover(provider).await;
    tauri::async_runtime::spawn_blocking(move || {
        open_with_fallback(provider, &targets, launch, |url| {
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|_| "Could not complete app launch. Please retry.".to_string())?
}

#[cfg(test)]
#[path = "../../../tests/rust/provider_apps.rs"]
mod tests;
