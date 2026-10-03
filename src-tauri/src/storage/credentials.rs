#[cfg(windows)]
pub fn protect(plain: &[u8]) -> Result<(&'static str, Vec<u8>), String> {
    transform(plain, true).map(|bytes| ("windows-dpapi-user-v1", bytes))
}

#[cfg(windows)]
pub fn unprotect(protection: &str, payload: &[u8]) -> Result<Vec<u8>, String> {
    if protection != "windows-dpapi-user-v1" {
        return Err(
            "Unsupported login protection. Update QuotaPeek or reconnect the account.".into(),
        );
    }
    transform(payload, false)
}

#[cfg(windows)]
fn transform(input: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::{LocalFree, HLOCAL},
            Security::Cryptography::{
                CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
            },
        },
    };
    let blob = CRYPT_INTEGER_BLOB {
        cbData: input
            .len()
            .try_into()
            .map_err(|_| "Login data is too large.")?,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // DPAPI owns the output allocation; always release it with LocalFree.
    unsafe {
        let result = if encrypt {
            CryptProtectData(
                &blob,
                PCWSTR::null(),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &blob,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if result.is_err() {
            return Err(if encrypt {
                "Could not protect the login."
            } else {
                "This saved login cannot be unlocked by this Windows user. Reconnect the account."
            }
            .into());
        }
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
        Ok(bytes)
    }
}

#[cfg(not(windows))]
pub fn protect(_plain: &[u8]) -> Result<(&'static str, Vec<u8>), String> {
    Err("Secure login storage is currently supported on Windows only.".into())
}
#[cfg(not(windows))]
pub fn unprotect(_protection: &str, _payload: &[u8]) -> Result<Vec<u8>, String> {
    Err("Reconnect this account on a platform with supported secure login storage.".into())
}
