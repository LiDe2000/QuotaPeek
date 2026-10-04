use providers::{codex, deepseek, workbuddy, zcode};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;
            let exe = std::env::current_exe()?;
            let installed =
                cfg!(feature = "installed") || std::env::args().any(|arg| arg == "--installed");
            let root = storage::data_root(&exe, &app.path().app_local_data_dir()?, installed)
                .map_err(std::io::Error::other)?;
            let database = storage::Database::open(&root.join("quotapeek.db"))
                .map_err(std::io::Error::other)?;
            app.manage(database);
            let mut webview = root.join("webview");
            // WebView2 profiles with different browser arguments must be separate.
            if let Some(args) = &app.config().app.windows[0].additional_browser_args {
                use sha2::{Digest, Sha256};
                webview = webview.join(format!("profile-{:x}", Sha256::digest(args.as_bytes())));
            }
            std::fs::create_dir_all(&webview)?;
            tauri::WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?
                .data_directory(webview)
                .build()?;
            #[cfg(windows)]
            {
                app.manage(desktop::drag::DragState::default());
                desktop::drag::setup(app)?;
            }
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            desktop::tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("Failed to hide QuotaPeek: {error}");
                }
            }
        })
        .manage(codex::QueryState::default())
        .manage(workbuddy::WorkbuddyState::default())
        .manage(zcode::ZcodeState::default())
        .manage(deepseek::DeepseekState::default())
        .manage(deepseek::login::LoginState::default())
        .manage(activities::ActivityState::default())
        .invoke_handler(tauri::generate_handler![
            activities::activity_load_catalog,
            activities::activity_execute,
            activities::zcode::activity_prepare_zcode_claim,
            activities::zcode::activity_submit_zcode_claim,
            storage::commands::storage_load,
            storage::commands::storage_save_settings,
            storage::commands::storage_save_cache,
            storage::commands::storage_remove_account,
            desktop::bounds::fit_window_bounds,
            codex::query_codex_quota,
            workbuddy::workbuddy_list_accounts,
            workbuddy::workbuddy_cancel_login,
            workbuddy::workbuddy_start_login,
            workbuddy::workbuddy_poll_login,
            workbuddy::workbuddy_query_quota,
            zcode::zcode_list_accounts,
            zcode::zcode_cancel_login,
            zcode::zcode_start_login,
            zcode::zcode_poll_login,
            zcode::zcode_query_quota,
            deepseek::deepseek_connect,
            deepseek::deepseek_list_accounts,
            deepseek::deepseek_query_balance,
            deepseek::login::deepseek_start_login,
            deepseek::login::deepseek_poll_login,
            deepseek::login::deepseek_cancel_login
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("Could not start QuotaPeek: {error}");
            #[cfg(windows)]
            unsafe {
                use windows::{
                    core::PCWSTR,
                    Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK},
                };
                let message: Vec<u16> = format!("Could not start QuotaPeek.\n\n{error}")
                    .encode_utf16()
                    .chain(Some(0))
                    .collect();
                let title: Vec<u16> = "QuotaPeek".encode_utf16().chain(Some(0)).collect();
                MessageBoxW(
                    None,
                    PCWSTR(message.as_ptr()),
                    PCWSTR(title.as_ptr()),
                    MB_OK | MB_ICONERROR,
                );
            }
        });
}
mod desktop;
mod providers;
mod storage;
mod activities;
