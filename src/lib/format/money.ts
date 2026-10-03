/** Round decimal strings for display without floating-point precision loss. */
export function formatMoney(amount: string, currency: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(amount);
  if (!match) throw new Error("Invalid monetary amount");
  const fraction = match[3] ?? "";
  const shift = Number(match[4] ?? 0) - fraction.length + 2;
  let cents = BigInt(match[2] + fraction);
  if (shift >= 0) {
    cents *= 10n ** BigInt(shift);
  } else {
    const divisor = 10n ** BigInt(-shift);
    cents = cents / divisor + (cents % divisor * 2n >= divisor ? 1n : 0n);
  }
  const sign = match[1] === "-" && cents !== 0n ? "-" : "";
  return `${sign}${currency === "CNY" ? "¥" : "$"}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
