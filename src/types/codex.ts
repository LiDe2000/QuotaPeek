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
}

export interface CodexTokenUsage {
  lifetimeTokens: number | null;
  todayTokens: number | null;
  latestDailyDate: string | null;
  latestDailyTokens: number | null;
}
