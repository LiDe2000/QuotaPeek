/** Account refresh timestamps are Unix seconds; display in the user's local timezone. */
export function formatRefreshTime(timestamp: number, includeDate = false): string {
  const date = new Date(timestamp * 1000);
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  };
  if (includeDate) {
    return date.toLocaleString(undefined, { ...options, year: "numeric", month: "2-digit", day: "2-digit" });
  }
  return date.toLocaleTimeString(undefined, options);
}
