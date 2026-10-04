export type QuotaLevel = "idle" | "ok" | "warn" | "hot";

/** Remaining share (0–100) → colour band. Green while there is room, amber as it
 *  thins, red near the ceiling — like Pulse. */
export function quotaLevel(percent: number | null): QuotaLevel {
  if (percent === null) return "idle";
  if (percent <= 15) return "hot";
  if (percent <= 40) return "warn";
  return "ok";
}
