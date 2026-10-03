use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::Manager;

#[derive(Serialize, Deserialize)]
pub struct Entry<T> {
    pub id: String,
    pub auth: T,
}

pub fn key(provider: &str, identity: &str) -> String {
    let encoded: String = identity
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("{provider}-{encoded}")
}

/// Discovery uses public metadata and works after moving to another Windows user.
pub fn read<T: DeserializeOwned>(
    app: &tauri::AppHandle,
    namespace: &str,
) -> Result<Vec<Entry<T>>, String> {
    app.state::<crate::storage::Database>().list(namespace)
}

/// Decrypt only the requested account, isolating failures from other accounts.
pub fn load<T: DeserializeOwned>(
    app: &tauri::AppHandle,
    namespace: &str,
    id: Option<&str>,
) -> Result<Option<Entry<T>>, String> {
    app.state::<crate::storage::Database>()
        .credential(namespace, id)
}

pub fn upsert<T: Serialize>(
    app: &tauri::AppHandle,
    namespace: &str,
    id: String,
    auth: T,
) -> Result<(), String> {
    app.state::<crate::storage::Database>()
        .upsert(namespace, &id, &auth)
}

#[cfg(test)]
#[path = "../../../tests/rust/account_store.rs"]
mod tests;
