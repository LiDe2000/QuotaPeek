import type { Account } from "../../types/quota";

export type Provider = Account["providerId"];
export type ProviderSelection = Partial<Record<Provider, string>>;
export const PROVIDER_SELECTION_KEY = "quotapeek-provider-selection-v1";
export const PROVIDER_ORDER_KEY = "quotapeek-provider-order-v1";
export const providerName: Record<Provider, string> = { codex: "Codex", workbuddy: "WorkBuddy", zcode: "ZCode", deepseek: "DeepSeek" };
export interface ProviderGroup { providerId: Provider; accounts: readonly Account[]; selected: Account }

/** Keep provider and account order stable while resolving missing remembered identities. */
export function providerGroups(accounts: readonly Account[], selection: ProviderSelection, order: readonly Provider[] = []): ProviderGroup[] {
  const grouped = new Map<Provider, Account[]>();
  for (const account of accounts) {
    const members = grouped.get(account.providerId) ?? [];
    members.push(account);
    grouped.set(account.providerId, members);
  }
  const ids = [...new Set([...order, ...grouped.keys()])].filter(id => grouped.has(id));
  return ids.map(providerId => {
    const members = grouped.get(providerId)!;
    return { providerId, accounts: members,
      selected: members.find(account => account.id === selection[providerId]) ?? members[0] };
  });
}

export function readProviderOrder(raw: string | null): Provider[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is Provider =>
      typeof id === "string" && Object.prototype.hasOwnProperty.call(providerName, id)))] : [];
  } catch { return []; }
}

export function moveProvider(order: readonly Provider[], source: Provider, target: Provider): Provider[] {
  const from = order.indexOf(source), to = order.indexOf(target);
  const next = [...order];
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}
export function readProviderSelection(raw: string | null): ProviderSelection {
  try {
    const value = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries((["codex", "workbuddy", "zcode", "deepseek"] as const)
      .filter(provider => typeof value[provider] === "string").map(provider => [provider, value[provider]]));
  } catch { return {}; }
}
