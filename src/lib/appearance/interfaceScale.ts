export const INTERFACE_SCALE = { min: 75, max: 150, step: 5, default: 100 } as const;
export const INTERFACE_SCALE_KEY = "quotapeek-interface-scale";

export function normalizeInterfaceScale(raw: string | number | null): number {
  if (raw === null || (typeof raw === "string" && raw.trim() === "")) return INTERFACE_SCALE.default;
  const value = Number(raw);
  if (!Number.isFinite(value)) return INTERFACE_SCALE.default;
  return Math.max(INTERFACE_SCALE.min, Math.min(INTERFACE_SCALE.max,
    Math.round(value / INTERFACE_SCALE.step) * INTERFACE_SCALE.step));
}
