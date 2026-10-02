import type { Account } from "../types/quota";

export const ACCOUNT_CACHE_KEY = "quotapeek-accounts-v2";

/** Update in place so refresh and reconnection cannot move the selected account. */
export function mergeAccount(accounts: readonly Account[], next: Account): readonly Account[] {
  const index = accounts.findIndex(account => account.id === next.id);
  if (index < 0) return [...accounts, next];
  return accounts.map((account, position) => position === index ? next : account);
}

export function cachedAccounts(value: string | null): readonly Account[] {
  try {
    const data: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    return data.filter((item): item is Account => {
      if (!item || typeof item.id !== "string" || seen.has(item.id) || typeof item.fetchedAt !== "number") return false;
      const valid = item.providerId === "codex" ? item.rateLimits && typeof item.rateLimits === "object"
        : item.providerId === "workbuddy" ? Array.isArray(item.packages) && Number.isFinite(item.totalSize) && Number.isFinite(item.totalUsed) && Number.isFinite(item.totalRemain)
        : item.providerId === "deepseek" ? typeof item.label === "string" && typeof item.isAvailable === "boolean" && Array.isArray(item.balances)
        : item.providerId === "zcode" && Array.isArray(item.windows);
      if (valid) seen.add(item.id);
      return !!valid;
    });
  } catch { return []; }
}

/** Restore credential-backed identities while keeping cached quota and user order. */
export function restoreAccounts(cached: readonly Account[], discovered: readonly Account[], providers: readonly Account["providerId"][]): readonly Account[] {
  const ids = new Set(discovered.map(account => account.id));
  const keep = cached.filter(account => account.providerId === "codex" || !providers.includes(account.providerId) || ids.has(account.id));
  return discovered.reduce<readonly Account[]>((accounts, account) => {
    const snapshot = keep.find(old => old.id === account.id);
    return mergeAccount(accounts, snapshot ? { ...account, ...snapshot } : account);
  }, keep);
}
