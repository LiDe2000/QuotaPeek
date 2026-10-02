import type { Account } from "../types/quota";

export interface SavedState { accounts: readonly Account[]; settings: Record<string, string> }
export interface StorageAdapter {
  load(): Promise<SavedState>;
  saveSettings(patch: Record<string, string>): Promise<void>;
  saveCache(accounts: readonly Account[]): Promise<void>;
}

/** Loaded before React mounts; all writes share a queue to preserve user order. */
export function createPersistentState(adapter: StorageAdapter) {
  let state: SavedState | null = null;
  let initialization: Promise<void> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let error: string | null = null;
  const listeners = new Set<() => void>();
  const failures = new Map<string, string>();
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
  function setSettings(patch: Record<string, string>): Promise<void> {
    const snapshot = { ...patch };
    Object.assign(loaded().settings, snapshot);
    return enqueue(`settings:${Object.keys(snapshot).sort().join(",")}`, () => adapter.saveSettings(snapshot));
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
      const snapshot = structuredClone(accounts);
      loaded().accounts = snapshot;
      return enqueue("cache", () => adapter.saveCache(snapshot));
    },
    subscribeError(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getError(): string | null { return error; },
  };
}
