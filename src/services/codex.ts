import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CodexAccount } from "../types/codex";
export async function queryCodexQuota(): Promise<CodexAccount> {
  if (!isTauri()) throw new Error("Open QuotaPeek as a desktop app (npm run tauri dev) to connect to local Codex.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const datePart = (type: string) => parts.find(part => part.type === type)?.value;
  const usageDate = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
  return invoke<CodexAccount>("query_codex_quota", { usageDate });
}
export function queryErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return "Could not query Codex. Please retry.";
}
