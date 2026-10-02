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
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture {
        root: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target/discovery-tests")
                .join(format!(
                    "{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                ));
            std::fs::create_dir_all(&root).unwrap();
            Self { root }
        }
        fn file(&self, relative: &str) -> PathBuf {
            let path = self.root.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, b"fixture").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let allowed = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/discovery-tests");
            assert!(self.root.starts_with(allowed));
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    #[test]
    fn discovers_desktop_installation_without_path() {
        let fixture = Fixture::new();
        let expected = fixture.file(&format!("desktop/opaque-version/{}", native_name()));
        std::fs::create_dir_all(fixture.root.join("desktop/newer-but-incomplete")).unwrap();
        assert_eq!(
            resolve(
                None,
                None,
                vec![fixture.root.join("missing"), fixture.root.join("desktop")]
            )
            .unwrap(),
            expected
        );
    }
    #[test]
    fn explicit_and_path_take_precedence_over_desktop() {
        let fixture = Fixture::new();
        let explicit = fixture.file(&format!("explicit/{}", native_name()));
        let path = fixture.file(&format!("path/{}", native_name()));
        fixture.file(&format!("desktop/version/{}", native_name()));
        let paths = std::env::join_paths([path.parent().unwrap()]).unwrap();
        let roots = vec![fixture.root.join("desktop")];
        assert_eq!(
            resolve(
                Some(explicit.clone().into()),
                Some(paths.clone()),
                roots.clone()
            )
            .unwrap(),
            explicit
        );
        assert_eq!(resolve(None, Some(paths), roots.clone()).unwrap(), path);
        assert!(resolve(Some(fixture.root.join("missing.exe").into()), None, roots).is_err());
    }
    #[test]
    fn ignores_relative_directories_and_missing_installations() {
        assert!(resolve(None, Some(OsString::from(".")), vec![PathBuf::from(".")]).is_err());
        assert!(resolve(None, None, vec![]).is_err());
    }
    #[test]
    fn uses_executable_timestamp_instead_of_opaque_version_name() {
        let fixture = Fixture::new();
        let old = fixture.file(&format!("desktop/zzz/{}", native_name()));
        let new = fixture.file(&format!("desktop/aaa/{}", native_name()));
        std::fs::File::options()
            .write(true)
            .open(old)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(100))
            .unwrap();
        assert_eq!(desktop_binary(&fixture.root.join("desktop")).unwrap(), new);
    }
    #[test]
    fn newer_versioned_binary_supersedes_legacy_direct_binary() {
        let fixture = Fixture::new();
        let old = fixture.file(&format!("desktop/{}", native_name()));
        let new = fixture.file(&format!("desktop/version/{}", native_name()));
        std::fs::File::options()
            .write(true)
            .open(old)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(100))
            .unwrap();
        assert_eq!(
            resolve(None, None, vec![fixture.root.join("desktop")]).unwrap(),
            new
        );
    }
    #[test]
    fn newer_direct_binary_supersedes_older_versioned_binary() {
        let fixture = Fixture::new();
        let old = fixture.file(&format!("desktop/version/{}", native_name()));
        let new = fixture.file(&format!("desktop/{}", native_name()));
        std::fs::File::options()
            .write(true)
            .open(old)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(100))
            .unwrap();
        assert_eq!(desktop_binary(&fixture.root.join("desktop")).unwrap(), new);
    }
    #[cfg(windows)]
    #[test]
    fn rejects_shell_wrapper_override() {
        let fixture = Fixture::new();
        let wrapper = fixture.file("codex.cmd");
        assert!(resolve(Some(wrapper.into()), None, vec![]).is_err());
    }
}
