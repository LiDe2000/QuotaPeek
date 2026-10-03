use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_NCDESTROY};

const OBSERVER_ID: usize = 0x51504452;
pub const DRAG_EVENT: &str = "desktop-window-dragging";

#[derive(Default)]
pub struct DragState(pub AtomicBool);

/// Follow the actual OS move loop; startDragging's promise only queues the drag.
pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window is missing")?;
    let hwnd = window.hwnd()?;
    let data = Box::into_raw(Box::new(app.handle().clone()));
    let installed =
        unsafe { SetWindowSubclass(hwnd, Some(observe_drag), OBSERVER_ID, data as usize) };
    if !installed.as_bool() {
        unsafe {
            drop(Box::from_raw(data));
        }
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

unsafe extern "system" fn observe_drag(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    data: usize,
) -> LRESULT {
    // The Box is owned by this subclass until the window's final destroy message.
    let app = &*(data as *const AppHandle);
    if message == WM_ENTERSIZEMOVE || message == WM_EXITSIZEMOVE {
        let dragging = message == WM_ENTERSIZEMOVE;
        app.state::<DragState>().0.store(dragging, Ordering::SeqCst);
        let _ = app.emit_to("main", DRAG_EVENT, dragging);
    }
    if message == WM_NCDESTROY {
        let _ = RemoveWindowSubclass(hwnd, Some(observe_drag), id);
        drop(Box::from_raw(data as *mut AppHandle));
    }
    DefSubclassProc(hwnd, message, wparam, lparam)
}
