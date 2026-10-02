/// Physical screen coordinates and dimensions, captured using one window DPI.
/// UI-thread geometry completion does not imply WebView2 has presented a frame.
#[tauri::command]
pub async fn fit_window_bounds(
    window: tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    clip_left: i32,
    visible_width: i32,
    source_x: i32,
    source_y: i32,
    visible_height: Option<i32>,
) -> Result<bool, String> {
    // Older frontends can omit this and keep height-based clipping.
    let visible_height = visible_height.unwrap_or(height);
    if width <= 0
        || height <= 0
        || clip_left < 0
        || visible_width <= 0
        || visible_height <= 0
        || visible_height > height
        || clip_left
            .checked_add(visible_width)
            .is_none_or(|right| right > width)
    {
        return Err("Invalid window bounds or visible region".into());
    }
    #[cfg(windows)]
    {
        use std::sync::atomic::Ordering;
        use tauri::Manager;
        use windows::Win32::Foundation::RECT;
        use windows::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject, SetWindowRgn};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
        };
        let (send, receive) = tokio::sync::oneshot::channel();
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                let result = target
                    .hwnd()
                    .map_err(|error| error.to_string())
                    .and_then(|hwnd| {
                        // The HWND belongs to this live Tauri window. Execute on its
                        // UI thread, without activating it or changing its Z order.
                        unsafe {
                            if target
                                .state::<crate::window_drag::DragState>()
                                .0
                                .load(Ordering::SeqCst)
                            {
                                return Ok(false);
                            }
                            let mut current = RECT::default();
                            GetWindowRect(hwnd, &mut current).map_err(|error| error.to_string())?;
                            // Discard geometry captured before the user moved the window.
                            if current.left != source_x || current.top != source_y {
                                return Ok(false);
                            }
                            if current.left != x
                                || current.top != y
                                || current.right - current.left != width
                                || current.bottom - current.top != height
                            {
                                SetWindowPos(
                                    hwnd,
                                    None,
                                    x,
                                    y,
                                    width,
                                    height,
                                    SWP_NOACTIVATE | SWP_NOZORDER,
                                )
                                .map_err(|error| error.to_string())?;
                            }
                            // The unused viewport must neither paint nor intercept input.
                            // Windows owns the region after a successful SetWindowRgn.
                            let region =
                                CreateRectRgn(clip_left, 0, clip_left + visible_width, visible_height);
                            if region.is_invalid() {
                                return Err("Failed to create window region".into());
                            }
                            if SetWindowRgn(hwnd, Some(region), false) == 0 {
                                let _ = DeleteObject(region.into());
                                return Err("Failed to apply window region".into());
                            }
                            Ok(true)
                        }
                    });
                let _ = send.send(result);
            })
            .map_err(|error| error.to_string())?;
        receive.await.map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        use tauri::{PhysicalPosition, PhysicalSize};
        let growing = width as u32
            > window
                .outer_size()
                .map_err(|error| error.to_string())?
                .width;
        if growing {
            window
                .set_position(PhysicalPosition::new(x, y))
                .map_err(|error| error.to_string())?;
        }
        window
            .set_size(PhysicalSize::new(width as u32, height as u32))
            .map_err(|error| error.to_string())?;
        if !growing {
            window
                .set_position(PhysicalPosition::new(x, y))
                .map_err(|error| error.to_string())?;
        }
        let _ = (source_x, source_y);
        Ok(true)
    }
}
