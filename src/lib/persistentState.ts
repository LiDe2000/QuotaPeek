import type { Account } from "../types/quota";
import { accountRemoval } from "./accountState";

export interface SavedState { accounts: readonly Account[]; settings: Record<string, string> }
export interface StorageAdapter {
  load(): Promise<SavedState>;
  saveSettings(patch: Record<string, string>): Promise<void>;
  saveCache(accounts: readonly Account[]): Promise<void>;
  removeAccount(id: string, selection: Record<string, string>): Promise<void>;
}

/** Loaded before React mounts; all writes share a queue to preserve user order. */
export function createPersistentState(adapter: StorageAdapter) {
  let state: SavedState | null = null;
  let initialization: Promise<void> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let error: string | null = null;
  const listeners = new Set<() => void>();
  const failures = new Map<string, string>();
  const removed = new Set<string>();
  function loaded(): SavedState {
    if (!state) throw new Error("Saved state has not been initialized.");
    return state;
  }
  function enqueue(key: string, save: () => Promise<void>): Promise<void> {
    const task = queue.then(save).then(() => { failures.delete(key); }, failure => {
      const message = typeof failure === "string" ? failure : failure instanceof Error ? failure.message : "Could not save changes.";
      failures.set(key, `Changes could not be saved: ${message}`);
      throw failure;
    }).finally(() => {
      error = [...failures.values()][0] ?? null;
      for (const listener of listeners) listener();
    });
    // A refused write must not poison the queue or swallow the caller's failure.
    queue = task.catch(() => {});
    return task;
  }
  function repairSettings(patch: Record<string, string>): Record<string, string> {
    if (!removed.size || !("quotapeek-selected-account" in patch || "quotapeek-provider-selection-v1" in patch)) return patch;
    let settings = { ...loaded().settings, ...patch };
    for (const id of removed) settings = { ...settings, ...accountRemoval(loaded().accounts, settings, id).settings };
    return { ...patch, "quotapeek-selected-account": settings["quotapeek-selected-account"], "quotapeek-provider-selection-v1": settings["quotapeek-provider-selection-v1"] };
  }
  function activeAccounts(accounts: readonly Account[]) { return accounts.filter(account => !removed.has(account.id)); }
  function setSettings(patch: Record<string, string>): Promise<void> {
    const snapshot = repairSettings({ ...patch });
    Object.assign(loaded().settings, snapshot);
    return enqueue(`settings:${Object.keys(snapshot).sort().join(",")}`, async () => {
      await adapter.saveSettings(repairSettings(snapshot));
    });
  }
  return {
    initialize(): Promise<void> {
      if (!initialization) initialization = adapter.load().then(saved => { state = structuredClone(saved); });
      return initialization;
    },
    getSetting(key: string): string | null { return loaded().settings[key] ?? null; },
    getAccounts(): readonly Account[] { return structuredClone(loaded().accounts); },
    setSettings,
    setSetting(key: string, value: string): Promise<void> {
      return setSettings({ [key]: value });
    },
    saveAccounts(accounts: readonly Account[]): Promise<void> {
      const snapshot = structuredClone(activeAccounts(accounts));
      loaded().accounts = snapshot;
      return enqueue("cache", () => adapter.saveCache(activeAccounts(snapshot)));
    },
    async removeAccount(id: string): Promise<SavedState> {
      await enqueue(`remove:${id}`, async () => {
        const plan = accountRemoval(loaded().accounts, loaded().settings, id);
        await adapter.removeAccount(id, plan.settings);
        removed.add(id);
        // Other accounts or selections may change while the deletion is awaiting IPC.
        const latest = accountRemoval(loaded().accounts, loaded().settings, id);
        loaded().accounts = latest.accounts;
        Object.assign(loaded().settings, latest.settings);
      });
      return structuredClone(loaded());
    },
    reconnectAccount(id: string): void { removed.delete(id); },
    subscribeError(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getError(): string | null { return error; },
  };
}
