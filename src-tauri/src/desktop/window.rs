use tauri::{AppHandle, Emitter, Manager};

const MAIN_WINDOW: &str = "main";
pub const SHOW_MAIN_EVENT: &str = "desktop-show-main";

pub fn show_main(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        window.unminimize()?;
        window.show()?;
        window.emit(SHOW_MAIN_EVENT, ())?;
        window.set_focus()?;
    }
    Ok(())
}

pub fn hide_main(app: &AppHandle) -> tauri::Result<()> {
    app.get_webview_window(MAIN_WINDOW)
        .map_or(Ok(()), |window| window.hide())
}
