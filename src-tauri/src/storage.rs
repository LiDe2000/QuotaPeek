use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior, MAIN_DB};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::Duration,
};

const APPLICATION_ID: i64 = 0x5150454b;
const CURRENT_VERSION: i64 = MIGRATIONS.len() as i64;
// Append migrations; never edit a migration that has shipped.
const MIGRATIONS: &[&str] = &[
    "CREATE TABLE accounts (
        id TEXT PRIMARY KEY, namespace TEXT NOT NULL, provider_id TEXT NOT NULL,
        public_auth TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
     );
     CREATE INDEX accounts_namespace ON accounts(namespace, position);
     CREATE TABLE credentials (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        protection TEXT NOT NULL, payload BLOB NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
     );
     CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "CREATE TABLE quota_cache (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        fetched_at INTEGER NOT NULL, format_version INTEGER NOT NULL DEFAULT 1,
        payload TEXT NOT NULL
     );",
];

pub struct Database {
    connection: Mutex<Connection>,
}

#[derive(Serialize)]
pub struct SavedState {
    pub accounts: Vec<Value>,
    pub settings: BTreeMap<String, String>,
}

pub fn data_root(exe: &Path, user_data: &Path, installed: bool) -> Result<PathBuf, String> {
    if installed {
        return Ok(user_data.to_path_buf());
    }
    exe.parent()
        .map(|dir| dir.join("data"))
        .ok_or_else(|| "Could not locate the executable directory.".into())
}

fn sql_error(error: rusqlite::Error) -> String {
    format!("Could not update saved data: {error}")
}

fn migrate(conn: &mut Connection, migrations: &[&str]) -> Result<(), String> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    let version: i64 = tx
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(sql_error)?;
    if version < 0 {
        return Err("Saved data has an invalid schema version.".into());
    }
    if version > migrations.len() as i64 {
        return Err("Saved data was created by a newer QuotaPeek. Update the application.".into());
    }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()));").map_err(sql_error)?;
    for (index, sql) in migrations.iter().enumerate().skip(version as usize) {
        tx.execute_batch(sql).map_err(sql_error)?;
        let next = index as i64 + 1;
        tx.execute("INSERT INTO schema_migrations(version) VALUES (?1)", [next])
            .map_err(sql_error)?;
        tx.pragma_update(None, "user_version", next)
            .map_err(sql_error)?;
    }
    tx.pragma_update(None, "application_id", APPLICATION_ID)
        .map_err(sql_error)?;
    tx.commit().map_err(sql_error)
}

const UI_SETTING_KEYS: &[&str] = &[
    "quotapeek-theme",
    "quotapeek-selected-account",
    "quotapeek-provider-selection-v1",
];

fn backup_before_upgrade(conn: &Connection, path: &Path, version: i64) -> Result<(), String> {
    let backup_path = path.with_extension(format!("db.v{version}.bak"));
    if backup_path.exists() {
        // A failed or externally damaged backup must never be accepted as protection.
        let invalid = || {
            "Could not verify the existing upgrade backup. Saved data has not been upgraded."
                .to_owned()
        };
        let backup = Connection::open_with_flags(&backup_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| invalid())?;
        let integrity: String = backup
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .map_err(|_| invalid())?;
        let saved_version: i64 = backup
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|_| invalid())?;
        let saved_id: i64 = backup
            .query_row("PRAGMA application_id", [], |row| row.get(0))
            .map_err(|_| invalid())?;
        if integrity != "ok" || saved_version != version || saved_id != APPLICATION_ID {
            return Err(invalid());
        }
        return Ok(());
    }
    // Publish the backup only once SQLite has finished copying it successfully.
    let temporary = path.with_extension(format!("db.v{version}.bak.tmp.{}", uuid::Uuid::new_v4()));
    let result = conn
        .backup(MAIN_DB, &temporary, None)
        .map_err(|error| format!("Could not back up saved data before upgrading: {error}"))
        .and_then(|_| {
            std::fs::rename(&temporary, &backup_path).map_err(|_| {
                "Could not finish the upgrade backup. Saved data has not been upgraded.".into()
            })
        });
    let _ = std::fs::remove_file(&temporary);
    result
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| {
                "Could not create the data directory. Move QuotaPeek to a writable folder."
            })?;
        }
        let mut conn = Connection::open(path).map_err(|_| {
            "Could not open saved data. Check the data directory and its permissions."
        })?;
        conn.busy_timeout(Duration::from_secs(5))
            .map_err(sql_error)?;
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(sql_error)?;
        let app_id: i64 = conn
            .query_row("PRAGMA application_id", [], |row| row.get(0))
            .map_err(sql_error)?;
        if version < 0 {
            return Err("Saved data has an invalid schema version.".into());
        }
        if app_id != 0 && app_id != APPLICATION_ID {
            return Err("This database does not belong to QuotaPeek.".into());
        }
        if version > CURRENT_VERSION {
            return Err(
                "Saved data was created by a newer QuotaPeek. Update the application.".into(),
            );
        }
        if app_id == 0 && conn.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |row| row.get::<_, i64>(0)).map_err(sql_error)? != 0 {
            return Err("This database does not belong to QuotaPeek.".into());
        }
        if version > 0 && version < CURRENT_VERSION {
            backup_before_upgrade(&conn, path, version)?;
        }
        conn.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;",
        )
        .map_err(sql_error)?;
        migrate(&mut conn, MIGRATIONS)?;
        Ok(Self {
            connection: Mutex::new(conn),
        })
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "Saved data is unavailable. Restart QuotaPeek.".into())
    }

    pub fn list<T: DeserializeOwned>(
        &self,
        namespace: &str,
    ) -> Result<Vec<crate::account_store::Entry<T>>, String> {
        let conn = self.lock()?;
        let mut query = conn.prepare("SELECT a.id, a.public_auth FROM accounts a JOIN credentials c ON c.account_id=a.id WHERE a.namespace=?1 ORDER BY a.position, a.rowid").map_err(sql_error)?;
        let rows = query
            .query_map([namespace], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(sql_error)?;
        rows.map(|row| {
            let (id, metadata) = row.map_err(sql_error)?;
            let auth = serde_json::from_str(&metadata)
                .map_err(|_| "Saved account details are unreadable.")?;
            Ok(crate::account_store::Entry { id, auth })
        })
        .collect()
    }

    pub fn credential<T: DeserializeOwned>(
        &self,
        namespace: &str,
        id: Option<&str>,
    ) -> Result<Option<crate::account_store::Entry<T>>, String> {
        let conn = self.lock()?;
        let stored: Option<(String, String, Vec<u8>)> = conn.query_row(
            "SELECT a.id, c.protection, c.payload FROM accounts a JOIN credentials c ON c.account_id=a.id WHERE a.namespace=?1 AND (?2 IS NULL OR a.id=?2) ORDER BY a.position, a.rowid LIMIT 1",
            params![namespace, id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).optional().map_err(sql_error)?;
        stored
            .map(|(id, protection, payload)| {
                let plain = crate::credential_protection::unprotect(&protection, &payload)?;
                let auth = serde_json::from_slice(&plain)
                    .map_err(|_| "Saved login is unreadable. Reconnect the account.")?;
                Ok(crate::account_store::Entry { id, auth })
            })
            .transpose()
    }

    pub fn upsert<T: Serialize>(&self, namespace: &str, id: &str, auth: &T) -> Result<(), String> {
        let value = serde_json::to_value(auth).map_err(|_| "Could not serialize the login.")?;
        let public_auth = public_auth(&value)?;
        let plain = serde_json::to_vec(&value).map_err(|_| "Could not serialize the login.")?;
        let (protection, payload) = crate::credential_protection::protect(&plain)?;
        let mut conn = self.lock()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        let provider = namespace.split('-').next().unwrap_or(namespace);
        tx.execute("INSERT INTO accounts(id,namespace,provider_id,public_auth,position) VALUES (?1,?2,?3,?4,(SELECT COALESCE(MAX(position)+1,0) FROM accounts)) ON CONFLICT(id) DO UPDATE SET public_auth=excluded.public_auth,updated_at=unixepoch() WHERE accounts.namespace=excluded.namespace", params![id, namespace, provider, public_auth]).map_err(sql_error)?;
        if tx.changes() == 0 {
            return Err("Saved account identity conflicts with another service.".into());
        }
        tx.execute("INSERT INTO credentials(account_id,protection,payload) VALUES (?1,?2,?3) ON CONFLICT(account_id) DO UPDATE SET protection=excluded.protection,payload=excluded.payload,updated_at=unixepoch()", params![id, protection, payload]).map_err(sql_error)?;
        tx.commit().map_err(sql_error)
    }

    pub fn load_state(&self) -> Result<SavedState, String> {
        let conn = self.lock()?;
        let mut query = conn.prepare("SELECT q.payload FROM quota_cache q JOIN accounts a ON a.id=q.account_id WHERE q.format_version=1 ORDER BY a.position, a.rowid").map_err(sql_error)?;
        let rows = query
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(sql_error)?;
        let accounts = rows
            .map(|row| {
                serde_json::from_str(&row.map_err(sql_error)?)
                    .map_err(|_| "Saved quota is unreadable.".into())
            })
            .collect::<Result<Vec<Value>, String>>()?;
        let mut query = conn
            .prepare("SELECT key,value FROM settings")
            .map_err(sql_error)?;
        let settings = query
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(sql_error)?
            .filter_map(|row| match row {
                Ok((key, value)) if UI_SETTING_KEYS.contains(&key.as_str()) => {
                    Some(Ok((key, value)))
                }
                Ok(_) => None,
                Err(e) => Some(Err(sql_error(e))),
            })
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        Ok(SavedState { accounts, settings })
    }

    pub fn save_settings(&self, patch: &BTreeMap<String, String>) -> Result<(), String> {
        if patch
            .iter()
            .any(|(key, value)| !UI_SETTING_KEYS.contains(&key.as_str()) || value.len() > 16_384)
        {
            return Err("Unsupported saved setting.".into());
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(sql_error)?;
        for (key, value) in patch {
            tx.execute("INSERT INTO settings(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value]).map_err(sql_error)?;
        }
        tx.commit().map_err(sql_error)
    }

    pub fn setting_or_insert(&self, key: &str, candidate: &str) -> Result<String, String> {
        let mut conn = self.lock()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        tx.execute(
            "INSERT OR IGNORE INTO settings(key,value) VALUES (?1,?2)",
            params![key, candidate],
        )
        .map_err(sql_error)?;
        let value = tx
            .query_row("SELECT value FROM settings WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .map_err(sql_error)?;
        tx.commit().map_err(sql_error)?;
        Ok(value)
    }

    pub fn remove_account(
        &self,
        id: &str,
        selection: &BTreeMap<String, String>,
    ) -> Result<(), String> {
        if id.is_empty()
            || id.len() > 512
            || selection.iter().any(|(key, value)| {
                ![
                    "quotapeek-selected-account",
                    "quotapeek-provider-selection-v1",
                ]
                .contains(&key.as_str())
                    || value.len() > 16_384
            })
        {
            return Err("Invalid account removal.".into());
        }
        let mut conn = self.lock()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        // Credentials and quota snapshots are deleted by the existing foreign keys.
        tx.execute("DELETE FROM accounts WHERE id=?1", [id])
            .map_err(sql_error)?;
        for (key, value) in selection {
            tx.execute("INSERT INTO settings(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value]).map_err(sql_error)?;
        }
        tx.commit().map_err(sql_error)
    }

    pub fn save_cache(&self, accounts: &[Value]) -> Result<(), String> {
        let mut conn = self.lock()?;
        let tx = conn.transaction().map_err(sql_error)?;
        for (position, account) in accounts.iter().enumerate() {
            let invalid = || "Quota cache has an invalid account.".to_owned();
            let id = account["id"]
                .as_str()
                .filter(|id| !id.is_empty() && id.len() <= 512)
                .ok_or_else(invalid)?;
            let provider = account["providerId"]
                .as_str()
                .filter(|p| ["codex", "workbuddy", "zcode", "deepseek"].contains(p))
                .ok_or_else(invalid)?;
            let fetched_at = account["fetchedAt"]
                .as_i64()
                .filter(|n| *n >= 0)
                .ok_or_else(invalid)?;
            let namespace = match provider {
                "codex" => "codex",
                "deepseek" if account["source"] == "deepseek-platform" => "deepseek-platform",
                "deepseek" => "deepseek-api",
                _ => provider,
            };
            tx.execute("INSERT INTO accounts(id,namespace,provider_id,position) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET position=excluded.position WHERE accounts.namespace=excluded.namespace", params![id,namespace,provider,position as i64]).map_err(sql_error)?;
            if tx.changes() == 0 {
                return Err(invalid());
            }
            tx.execute("INSERT INTO quota_cache(account_id,fetched_at,payload) VALUES (?1,?2,?3) ON CONFLICT(account_id) DO UPDATE SET fetched_at=excluded.fetched_at,payload=excluded.payload,format_version=excluded.format_version WHERE excluded.fetched_at >= quota_cache.fetched_at", params![id,fetched_at,account.to_string()]).map_err(sql_error)?;
        }
        tx.commit().map_err(sql_error)
    }
}

// Metadata can be listed after a folder is copied to a different Windows user.
// Only explicitly recognized public fields leave the encrypted credential blob.
fn public_auth(value: &Value) -> Result<String, String> {
    let object = value
        .as_object()
        .ok_or("Login details must be an object.")?;
    let mut result = serde_json::Map::new();
    for key in [
        "identity",
        "label",
        "email",
        "provider",
        "site",
        "expiresAt",
        "domain",
        "uid",
        "nickname",
        "enterpriseId",
        "userId",
        "contact",
    ] {
        if let Some(value) = object.get(key) {
            result.insert(key.into(), value.clone());
        }
    }
    for key in [
        "accessToken",
        "refreshToken",
        "zcodeJwtToken",
        "apiKey",
        "token",
    ] {
        if object.contains_key(key) {
            result.insert(key.into(), Value::String(String::new()));
        }
    }
    Ok(Value::Object(result).to_string())
}

#[cfg(test)]
mod tests;
