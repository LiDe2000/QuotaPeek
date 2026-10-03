import type { Account } from "../../types/quota";
import { PROVIDER_SELECTION_KEY, readProviderSelection } from "../providers/providerGroups";

/** Remove one identity and repair only selections pointing at it. */
export function accountRemoval(accounts: readonly Account[], settings: Record<string, string>, id: string) {
  const remaining = accounts.filter(account => account.id !== id);
  const selection = readProviderSelection(settings[PROVIDER_SELECTION_KEY] ?? null);
  const provider = accounts.find(account => account.id === id)?.providerId
    ?? Object.entries(selection).find(([, selected]) => selected === id)?.[0];
  const fallback = remaining.find(account => account.providerId === provider) ?? remaining[0];
  for (const key of Object.keys(selection) as Account["providerId"][]) {
    if (selection[key] !== id) continue;
    const next = remaining.find(account => account.providerId === key);
    if (next) selection[key] = next.id; else delete selection[key];
  }
  return { accounts: remaining, settings: {
    "quotapeek-selected-account": settings["quotapeek-selected-account"] === id
      ? fallback?.id ?? "" : settings["quotapeek-selected-account"] ?? "",
    [PROVIDER_SELECTION_KEY]: JSON.stringify(selection),
  } };
}


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
    }).map(account => {
      // Earlier DeepSeek snapshots used milliseconds; all account timestamps use seconds.
      if (account.providerId === "deepseek" && account.fetchedAt >= 1_000_000_000_000) {
        return { ...account, fetchedAt: Math.floor(account.fetchedAt / 1000) };
      }
      return account;
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
