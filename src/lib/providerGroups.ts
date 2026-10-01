import type { Account } from "../types/quota";

export type Provider = Account["providerId"];
export type ProviderSelection = Partial<Record<Provider, string>>;
export const PROVIDER_SELECTION_KEY = "quotapeek-provider-selection-v1";
export const providerName: Record<Provider, string> = { codex: "Codex", workbuddy: "WorkBuddy", zcode: "ZCode" };
export interface ProviderGroup { providerId: Provider; accounts: readonly Account[]; selected: Account }

/** Keep provider and account order stable while resolving missing remembered identities. */
export function providerGroups(accounts: readonly Account[], selection: ProviderSelection): ProviderGroup[] {
  const grouped = new Map<Provider, Account[]>();
  for (const account of accounts) {
    const members = grouped.get(account.providerId) ?? [];
    members.push(account);
    grouped.set(account.providerId, members);
  }
  return Array.from(grouped, ([providerId, members]) => ({ providerId, accounts: members,
    selected: members.find(account => account.id === selection[providerId]) ?? members[0] }));
}
export function readProviderSelection(raw: string | null): ProviderSelection {
  try {
    const value = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries((["codex", "workbuddy", "zcode"] as const)
      .filter(provider => typeof value[provider] === "string").map(provider => [provider, value[provider]]));
  } catch { return {}; }
}
