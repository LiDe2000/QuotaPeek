use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{io, path::Path};

#[derive(Serialize, Deserialize)]
pub struct Entry<T> {
    pub id: String,
    pub auth: T,
}

pub fn key(provider: &str, identity: &str) -> String {
    let encoded: String = identity.as_bytes().iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{provider}-{encoded}")
}

pub fn read<T: DeserializeOwned>(path: &Path) -> Result<Vec<Entry<T>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "Stored accounts are unreadable. Reconnect the account.".into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err("Could not read stored accounts.".into()),
    }
}

pub fn upsert<T: Serialize + DeserializeOwned>(path: &Path, id: String, auth: T) -> Result<(), String> {
    let mut entries: Vec<Entry<T>> = read(path)?;
    if let Some(entry) = entries.iter_mut().find(|entry| entry.id == id) {
        entry.auth = auth;
    } else {
        entries.push(Entry { id, auth });
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "Could not create the account directory.")?;
    }
    let bytes = serde_json::to_vec_pretty(&entries).map_err(|_| "Could not serialize accounts.")?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, bytes).map_err(|_| "Could not save accounts.")?;
    std::fs::rename(temporary, path).map_err(|_| "Could not finish saving accounts.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identities_are_unambiguous_and_do_not_depend_on_tokens() {
        assert_ne!(key("workbuddy", "cn:user"), key("workbuddy", "global:user"));
        assert_ne!(key("zcode", "zai:one"), key("zcode", "zai:two"));
        assert_eq!(key("zcode", "zai:one"), key("zcode", "zai:one"));
    }
    #[test]
    fn updates_preserve_other_accounts_and_order() {
        let root = std::env::temp_dir().join(format!("quotapeek-accounts-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        let path = root.join("accounts.json");
        upsert(&path, "a".into(), "first".to_owned()).unwrap();
        upsert(&path, "b".into(), "second".to_owned()).unwrap();
        upsert(&path, "a".into(), "updated".to_owned()).unwrap();
        let entries = read::<String>(&path).unwrap();
        assert_eq!(entries.iter().map(|entry| entry.id.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(entries[0].auth, "updated");
        assert_eq!(entries[1].auth, "second");
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
