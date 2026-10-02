import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DeepseekAccount } from "../types/deepseek";
export function connectDeepseek(apiKey: string, label: string): Promise<DeepseekAccount> {
  if (!isTauri()) throw new Error("Open QuotaPeek as a desktop app to connect DeepSeek.");
  return invoke("deepseek_connect", { apiKey, label });
}
export function listDeepseekAccounts(): Promise<DeepseekAccount[]> {
  return invoke("deepseek_list_accounts");
}
export function queryDeepseekBalance(accountId?: string): Promise<DeepseekAccount> {
  return invoke("deepseek_query_balance", { accountId });
}
export function startDeepseekLogin(): Promise<{ state: string; authUrl: string }> {
  if (!isTauri()) throw new Error("Open QuotaPeek as a desktop app to sign in to DeepSeek.");
  return invoke("deepseek_start_login");
}
export function pollDeepseekLogin(loginState: string): Promise<{ status: "pending" | "success" | "error"; message: string | null; accountId: string | null }> {
  return invoke("deepseek_poll_login", { loginState });
}
export function cancelDeepseekLogin(loginState: string): Promise<string | null> {
  return invoke("deepseek_cancel_login", { loginState });
}
