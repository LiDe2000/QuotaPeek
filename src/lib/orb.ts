import type { Account } from "../types/quota";

export interface OrbMeter {
  /** 0–100 remaining share, matching the quota card. */
  percent: number | null;
  used: number | null;
  total: number | null;
}
const empty: OrbMeter = { percent: null, used: null, total: null };
function remaining(used: number): number { return Math.max(0, Math.min(100, 100 - used)); }
export function orbMeter(account: Account): OrbMeter {
  if (account.providerId === "deepseek") return empty;
  if (account.providerId === "workbuddy") return account.totalSize > 0
    ? { percent: remaining(account.totalUsed / account.totalSize * 100), used: account.totalUsed, total: account.totalSize } : empty;
  if (account.providerId === "zcode") {
    let used = 0;
    let total = 0;
    for (const quota of account.windows) {
      if (quota.used === null || quota.total === null || quota.total <= 0) continue;
      used += quota.used;
      total += quota.total;
    }
    return total > 0 ? { percent: remaining(used / total * 100), used, total } : empty;
  }
  // A constrained weekly or secondary window matters even when primary has room.
  const windows = Object.values(account.rateLimits).flatMap(bucket => [bucket.primary, bucket.secondary])
    .filter(window => window !== null && Number.isFinite(window.usedPercent));
  return windows.length ? { percent: remaining(Math.max(...windows.map(window => window!.usedPercent))), used: null, total: null } : empty;
}
