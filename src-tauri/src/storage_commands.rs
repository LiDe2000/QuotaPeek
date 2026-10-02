use crate::storage::{Database, SavedState};
use serde_json::Value;
use std::collections::BTreeMap;

#[tauri::command]
pub fn storage_load(state: tauri::State<'_, Database>) -> Result<SavedState, String> {
    state.load_state()
}

#[tauri::command]
pub fn storage_save_settings(
    state: tauri::State<'_, Database>,
    patch: BTreeMap<String, String>,
) -> Result<(), String> {
    state.save_settings(&patch)
}

#[tauri::command]
pub fn storage_save_cache(
    state: tauri::State<'_, Database>,
    accounts: Vec<Value>,
) -> Result<(), String> {
    state.save_cache(&accounts)
}
