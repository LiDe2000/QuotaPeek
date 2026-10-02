import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { Account } from "../types/quota";
import { queryCodexQuota, queryErrorMessage } from "../services/codex";
import { listWorkbuddyAccounts, queryWorkbuddyQuota } from "../services/workbuddy";
import { listZcodeAccounts, queryZcodeQuota } from "../services/zcode";
import { listDeepseekAccounts, queryDeepseekBalance } from "../services/deepseek";
import { refreshCooldown } from "../lib/refreshCooldown";
import { mergeAccount, restoreAccounts } from "../lib/accountState";
import { storage } from "../services/storage";

type Provider = Account["providerId"];
export interface AccountStatus { loading: boolean; error: string | null; lastSuccess: number | null; notice?: string | null; removing?: boolean }
const idle: AccountStatus = { loading: false, error: null, lastSuccess: null };
function readCache() {
  return storage.getAccounts();
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<readonly Account[]>(readCache);
  const [statuses, setStatuses] = useState<Record<string, AccountStatus>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(isTauri);
  const [startupErrors, setStartupErrors] = useState<string[]>([]);
  const accountsRef = useRef(accounts);
  const lastFinished = useRef(new Map<string, number>());
  const noticeTimers = useRef(new Map<string, number>());
  const requests = useRef(new Map<string, Promise<Account | null>>());
  const startup = useRef<Promise<void> | null>(null);
  const allRefresh = useRef<Promise<void> | null>(null);
  const removals = useRef(new Map<string, Promise<boolean>>());
  const removed = useRef(new Set<string>());

  function blocked(id: string) { return removed.current.has(id) || removals.current.has(id); }

  function commit(next: readonly Account[]) { accountsRef.current = next; setAccounts(next); }
  function merge(next: Account) { commit(mergeAccount(accountsRef.current, next)); }
  function status(id: string, patch: Partial<AccountStatus>) {
    setStatuses(previous => ({ ...previous, [id]: { ...idle, ...previous[id], ...patch } }));
  }
  function refresh(provider: Provider, accountId?: string): Promise<Account | null> {
    const id = accountId ?? "codex-local";
    if (blocked(id)) return Promise.resolve(null);
    const current = requests.current.get(id);
    if (current) return current;
    const timer = noticeTimers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    noticeTimers.current.delete(id);
    status(id, { loading: true, error: null, notice: null });
    const task = (async () => {
      try {
        const next = provider === "codex" ? await queryCodexQuota()
          : provider === "workbuddy" ? await queryWorkbuddyQuota(accountId)
          : provider === "deepseek" ? await queryDeepseekBalance(accountId) : await queryZcodeQuota(accountId);
        if (blocked(id)) return null;
        merge(next);
        status(next.id, { loading: false, error: null, lastSuccess: next.fetchedAt });
        return next;
      } catch (failure) {
        if (!blocked(id)) status(id, { loading: false, error: queryErrorMessage(failure) });
        return null;
      } finally { lastFinished.current.set(id, Date.now()); requests.current.delete(id); }
    })();
    requests.current.set(id, task);
    return task;
  }

  function manualRefresh(provider: Provider, accountId: string): Promise<Account | null> {
    if (blocked(accountId)) return Promise.resolve(null);
    const running = requests.current.get(accountId);
    if (running) return running;
    const remaining = refreshCooldown(Date.now(), lastFinished.current.get(accountId));
    if (remaining > 0) {
      const timer = noticeTimers.current.get(accountId);
      if (timer !== undefined) window.clearTimeout(timer);
      status(accountId, { notice: statuses[accountId]?.error ? "Please wait a few seconds before retrying." : "Just refreshed · Please wait a few seconds." });
      noticeTimers.current.set(accountId, window.setTimeout(() => {
        noticeTimers.current.delete(accountId);
        status(accountId, { notice: null });
      }, Math.min(remaining, 3000)));
      return Promise.resolve(accountsRef.current.find(account => account.id === accountId) ?? null);
    }
    return refresh(provider, accountId);
  }
  useEffect(() => () => {
    for (const timer of noticeTimers.current.values()) window.clearTimeout(timer);
    noticeTimers.current.clear();
  }, []);

  async function connect(provider: Provider, accountId?: string, onRegistered?: (id: string) => void): Promise<Account | null> {
    const target = provider === "codex" ? "codex-local" : accountId;
    if (target && removals.current.has(target)) return null;
    function reconnect(id: string) { removed.current.delete(id); storage.reconnectAccount(id); }
    if (provider !== "codex") {
      try {
        const known = provider === "workbuddy" ? await listWorkbuddyAccounts()
          : provider === "deepseek" ? await listDeepseekAccounts() : await listZcodeAccounts();
        if (target && known.some(account => account.id === target)) reconnect(target);
        for (const account of known) if (!blocked(account.id) && !accountsRef.current.some(old => old.id === account.id)) merge(account);
        if (accountId && known.some(account => account.id === accountId)) onRegistered?.(accountId);
      } catch (failure) {
        status(accountId ?? provider, { error: queryErrorMessage(failure) });
        return null;
      }
    } else reconnect("codex-local");
    return refresh(provider, accountId);
  }

  function removeAccount(id: string): Promise<boolean> {
    const running = removals.current.get(id);
    if (running) return running;
    if (restoring || !accountsRef.current.some(account => account.id === id)) return Promise.resolve(false);
    status(id, { removing: true, loading: false, error: null, notice: null });
    const task = (async () => {
      try {
        // A quota query can rotate saved credentials. Let it finish before deleting
        // those credentials, while blocked() prevents its response from restoring UI.
        await requests.current.get(id);
        await storage.removeAccount(id);
        removed.current.add(id);
        commit(accountsRef.current.filter(account => account.id !== id));
        const timer = noticeTimers.current.get(id);
        if (timer !== undefined) window.clearTimeout(timer);
        noticeTimers.current.delete(id);
        lastFinished.current.delete(id);
        setStatuses(previous => { const next = { ...previous }; delete next[id]; return next; });
        setSummary(null);
        return true;
      } catch (failure) {
        status(id, { removing: false, loading: false, error: typeof failure === "string" ? failure : queryErrorMessage(failure) });
        return false;
      } finally { removals.current.delete(id); }
    })();
    removals.current.set(id, task);
    return task;
  }

  function refreshAll(): Promise<void> {
    if (allRefresh.current) return allRefresh.current;
    const targets = [...accountsRef.current];
    setSummary("Refreshing all accounts…");
    const task = (async () => {
      let succeeded = 0;
      for (const account of targets) if (await refresh(account.providerId, account.id)) succeeded++;
      setSummary(`Refresh complete · ${succeeded}/${targets.length} succeeded${succeeded < targets.length ? ` · ${targets.length - succeeded} failed` : ""}`);
    })().finally(() => { allRefresh.current = null; });
    allRefresh.current = task;
    return task;
  }

  useEffect(() => {
    void storage.saveAccounts(accounts).catch(() => {});
  }, [accounts]);

  useEffect(() => {
    if (!isTauri()) return;
    // A single promise also prevents React StrictMode from issuing duplicate startup queries.
    if (!startup.current) startup.current = (async () => {
      const results = await Promise.allSettled([listWorkbuddyAccounts(), listZcodeAccounts(), listDeepseekAccounts()]);
      const discovered: Account[] = [];
      const providers: Provider[] = [];
      const errors: string[] = [];
      results.forEach((result, index) => {
        const provider = (["workbuddy", "zcode", "deepseek"] as const)[index];
        if (result.status === "fulfilled") { providers.push(provider); discovered.push(...result.value); }
        else errors.push(`${provider}: ${queryErrorMessage(result.reason)}`);
      });
      setStartupErrors(errors);
      commit(restoreAccounts(accountsRef.current, discovered, providers));
      // Only reconnect the local Codex entry after the user has connected it before.
      const targets = [...accountsRef.current];
      for (const account of targets) await refresh(account.providerId, account.id);
      setRestoring(false);
    })();
  }, []);

  return { accounts, statuses, summary, restoring, startupErrors, manualRefresh, refreshAll, connect, removeAccount };
}
