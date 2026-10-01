use crate::desktop_window;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle,
};

fn handle_action(app: &AppHandle, id: &str) -> tauri::Result<()> {
    match id {
        "tray-show" => desktop_window::show_main(app),
        "tray-hide" => desktop_window::hide_main(app),
        "tray-quit" => {
            app.exit(0);
            Ok(())
        }
        _ => Ok(()),
    }
}

pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "tray-show", "Show", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "tray-hide", "Hide", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &quit])?;
    let mut tray = TrayIconBuilder::with_id("quotapeek-tray")
        .tooltip("QuotaPeek")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if let Err(error) = handle_action(app, event.id.as_ref()) {
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
                if let Err(error) = desktop_window::show_main(tray.app_handle()) {
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
