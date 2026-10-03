use super::window;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

fn handle_action(
    app: &AppHandle,
    id: &str,
    always_on_top: &CheckMenuItem<tauri::Wry>,
) -> tauri::Result<()> {
    match id {
        "tray-show" => window::show_main(app),
        "tray-hide" => window::hide_main(app),
        "tray-always-on-top" => {
            if let Some(window) = app.get_webview_window("main") {
                let current = window.is_always_on_top()?;
                if let Err(error) = window.set_always_on_top(!current) {
                    // Native check items toggle before the callback; restore on failure.
                    always_on_top.set_checked(current)?;
                    return Err(error);
                }
                always_on_top.set_checked(!current)?;
            }
            Ok(())
        }
        "tray-quit" => {
            app.exit(0);
            Ok(())
        }
        _ => Ok(()),
    }
}

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let version = MenuItem::with_id(
        app,
        "tray-version",
        format!("v{}", app.package_info().version),
        false,
        None::<&str>,
    )?;
    let version_separator = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "tray-show", "Show", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "tray-hide", "Hide", true, None::<&str>)?;
    let window = app.get_webview_window("main");
    let pinned = window
        .as_ref()
        .map(|window| window.is_always_on_top())
        .transpose()?
        .unwrap_or(false);
    let always_on_top = CheckMenuItem::with_id(
        app,
        "tray-always-on-top",
        "Always on Top",
        window.is_some(),
        pinned,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &version,
            &version_separator,
            &show,
            &hide,
            &always_on_top,
            &separator,
            &quit,
        ],
    )?;
    let mut tray = TrayIconBuilder::with_id("quotapeek-tray")
        .tooltip("QuotaPeek")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            if let Err(error) = handle_action(app, event.id.as_ref(), &always_on_top) {
                eprintln!("Tray action failed: {error}");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                if let Err(error) = window::show_main(tray.app_handle()) {
                    eprintln!("Failed to show QuotaPeek: {error}");
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
