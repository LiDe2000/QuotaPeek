#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(codex::QueryState::default())
        .manage(workbuddy::WorkbuddyState::default())
        .invoke_handler(tauri::generate_handler![
            codex::query_codex_quota,
            workbuddy::workbuddy_start_login,
            workbuddy::workbuddy_poll_login,
            workbuddy::workbuddy_query_quota
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
mod codex;
mod codex_executable;
mod workbuddy;
