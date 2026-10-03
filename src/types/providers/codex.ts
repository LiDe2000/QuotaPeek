export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}
export interface CodexRateLimitBucket {
  limitId: string | null;
  limitName: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  planType: string | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  individualLimit: { limit: string; used: string; remainingPercent: number; resetsAt: number } | null;
  spendControlReached: boolean | null;
  rateLimitReachedType: string | null;
}
export interface CodexAccount {
  id: "codex-local";
  providerId: "codex";
  source: "codex-app-server";
  accountId: string | null;
  email: string | null;
  planType: string | null;
  fetchedAt: number;
  rateLimits: Record<string, CodexRateLimitBucket>;
  tokenUsage: CodexTokenUsage | null;
  /** Undefined/null means unavailable, including snapshots cached by older versions. */
  rateLimitResetCredits?: CodexResetCredits | null;
}
export interface CodexResetCredits {
  /** Authoritative count; detail rows can be capped or unavailable. */
  availableCount: number;
  credits: { id: string; resetType: string; status: string; expiresAt: number | null; title: string | null; description: string | null }[] | null;
}

export interface CodexTokenUsage {
  lifetimeTokens: number | null;
  todayTokens: number | null;
  latestDailyDate: string | null;
  latestDailyTokens: number | null;
}
