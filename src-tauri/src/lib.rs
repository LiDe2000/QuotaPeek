#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(windows)]
            {
                use tauri::Manager;
                app.manage(window_drag::DragState::default());
                window_drag::setup(app)?;
            }
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            tray::setup(app)?;
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
        .manage(deepseek_login::LoginState::default())
        .invoke_handler(tauri::generate_handler![
            window_bounds::fit_window_bounds,
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
            deepseek_login::deepseek_start_login,
            deepseek_login::deepseek_poll_login,
            deepseek_login::deepseek_cancel_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
mod account_store;
mod deepseek;
mod deepseek_login;
mod deepseek_wallet;
mod window_bounds;
#[cfg(windows)]
mod window_drag;
mod codex;
mod codex_executable;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop_window;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod tray;
mod workbuddy;
mod zcode;
