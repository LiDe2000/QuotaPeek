import { invoke, isTauri } from "@tauri-apps/api/core";
import type { WorkbuddyAccount } from "../types/workbuddy";
export interface WorkbuddyLoginStart { state: string; authUrl: string }
export interface WorkbuddyPoll { status: "pending" | "success" | "error"; message: string | null; accountId: string | null }
export async function startWorkbuddyLogin(): Promise<WorkbuddyLoginStart> {
  if (!isTauri()) throw new Error("Open QuotaPeek as a desktop app (npm run tauri dev) to sign in to WorkBuddy.");
  return invoke<WorkbuddyLoginStart>("workbuddy_start_login");
}
export async function pollWorkbuddyLogin(loginState: string): Promise<WorkbuddyPoll> {
  return invoke<WorkbuddyPoll>("workbuddy_poll_login", { loginState });
}
export async function queryWorkbuddyQuota(accountId?: string): Promise<WorkbuddyAccount> {
  if (!isTauri()) throw new Error("Open QuotaPeek as a desktop app (npm run tauri dev) to read WorkBuddy credits.");
  return invoke<WorkbuddyAccount>("workbuddy_query_quota", { accountId });
}
export function workbuddyErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return "Could not read WorkBuddy credits. Please retry.";
}

export function listWorkbuddyAccounts(): Promise<WorkbuddyAccount[]> {
  return invoke<WorkbuddyAccount[]>("workbuddy_list_accounts");
}
export function cancelWorkbuddyLogin(loginState: string): Promise<string | null> {
  return invoke("workbuddy_cancel_login", { loginState });
}
