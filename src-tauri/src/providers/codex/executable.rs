use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    time::SystemTime,
};

/// Resolve a native executable without invoking shell wrappers or searching the working directory.
pub fn find() -> Result<PathBuf, &'static str> {
    resolve(
        std::env::var_os("QUOTAPEEK_CODEX_PATH"),
        std::env::var_os("PATH"),
        desktop_roots(),
    )
}

fn native_name() -> &'static str {
    if cfg!(windows) {
        "codex.exe"
    } else {
        "codex"
    }
}

fn native_file(path: &Path) -> bool {
    if !path.is_absolute() || !path.is_file() {
        return false;
    }
    #[cfg(windows)]
    {
        path.extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
    }
}

fn desktop_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            roots.push(PathBuf::from(local).join("OpenAI/Codex/bin"));
        }
        // Some GUI launch environments omit LOCALAPPDATA.
        if let Some(home) = std::env::var_os("USERPROFILE") {
            let root = PathBuf::from(home).join("AppData/Local/OpenAI/Codex/bin");
            if !roots.contains(&root) {
                roots.push(root);
            }
        }
    }
    #[cfg(not(windows))]
    {
        // Keep non-Windows discovery on the existing explicit/PATH routes.
        roots.shrink_to_fit();
    }
    roots
}

fn resolve(
    explicit: Option<OsString>,
    paths: Option<OsString>,
    roots: Vec<PathBuf>,
) -> Result<PathBuf, &'static str> {
    if let Some(explicit) = explicit {
        let candidate = PathBuf::from(explicit);
        return if native_file(&candidate) {
            Ok(candidate)
        } else {
            Err("QUOTAPEEK_CODEX_PATH must point to an existing native Codex executable (codex.exe on Windows), not a .cmd or .ps1 wrapper.")
        };
    }
    if let Some(paths) = paths {
        for directory in std::env::split_paths(&paths) {
            let candidate = directory.join(native_name());
            if native_file(&candidate) {
                return Ok(candidate);
            }
        }
    }
    for root in roots {
        if let Some(candidate) = desktop_binary(&root) {
            return Ok(candidate);
        }
    }
    Err("Codex executable not found in PATH or the local Codex desktop installation. Install Codex or set QUOTAPEEK_CODEX_PATH to its native executable, then restart QuotaPeek.")
}

fn desktop_binary(root: &Path) -> Option<PathBuf> {
    if !root.is_absolute() {
        return None;
    }
    // Desktop updates may leave a legacy binary directly in bin/. Compare it
    // with the versioned binaries instead of letting it mask newer installations.
    // Version names are opaque; rank executable timestamps, not directory names.
    let versioned = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path().join(native_name()));
    let mut candidates: Vec<_> = std::iter::once(root.join(native_name()))
        .chain(versioned)
        .filter(|candidate| native_file(candidate))
        .map(|candidate| {
            let modified = candidate
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            (modified, candidate)
        })
        .collect();
    candidates.sort_by(|a, b| b.cmp(a));
    candidates
        .into_iter()
        .next()
        .map(|(_, candidate)| candidate)
}

#[cfg(test)]
#[path = "../../../../tests/rust/codex_executable.rs"]
mod tests;
