pub(crate) mod bounds;
#[cfg(windows)]
pub(crate) mod drag;
pub(crate) mod provider_apps;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) mod tray;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) mod window;
