/** Match the provider query spacing and suppress clicks immediately after a reply. */
export const MANUAL_REFRESH_COOLDOWN_MS = 10_000;
export function refreshCooldown(now: number, lastFinished: number | undefined): number {
  if (lastFinished === undefined) return 0;
  return Math.max(0, Math.min(MANUAL_REFRESH_COOLDOWN_MS, MANUAL_REFRESH_COOLDOWN_MS - (now - lastFinished)));
}
