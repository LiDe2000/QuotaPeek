import { invoke, isTauri } from "@tauri-apps/api/core";
import { createPersistentState } from "../lib/storage/persistentState";
import type { SavedState } from "../lib/storage/persistentState";
import { cachedAccounts } from "../lib/accounts/accountState";

export const storage = createPersistentState({
  async load() {
    if (!isTauri()) return { accounts: [], settings: {} };
    const saved = await invoke<SavedState>("storage_load");
    return { accounts: cachedAccounts(JSON.stringify(saved.accounts)), settings: saved.settings };
  },
  async saveSettings(patch) { if (isTauri()) await invoke("storage_save_settings", { patch }); },
  async saveCache(accounts) { if (isTauri()) await invoke("storage_save_cache", { accounts }); },
  async removeAccount(id, selection) { if (isTauri()) await invoke("storage_remove_account", { id, selection }); },
});

// Failures are reported by the shared storage status, while interaction stays usable.
export function saveSetting(key: string, value: string): void {
  void storage.setSetting(key, value).catch(() => {});
}
export function saveSettings(patch: Record<string, string>): void {
  void storage.setSettings(patch).catch(() => {});
}
