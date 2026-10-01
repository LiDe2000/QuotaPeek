import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ZcodeAccount } from "../types/zcode";
export interface ZcodeLoginStart { state: string; authUrl: string }
export interface ZcodePoll { status: "pending" | "success" | "error"; message: string | null }
/** ZCode binds either a Z.ai (global) or a BigModel (智谱, China) account; the site picks the sign-in page. */
export type ZcodeSite = "zai" | "bigmodel";
export async function startZcodeLogin(site: ZcodeSite): Promise<ZcodeLoginStart> {
  if (!isTauri()) throw new Error("Open QuotaPeek as a desktop app (npm run tauri dev) to sign in to ZCode.");
  return invoke<ZcodeLoginStart>("zcode_start_login", { site });
}
export async function pollZcodeLogin(loginState: string): Promise<ZcodePoll> {
  return invoke<ZcodePoll>("zcode_poll_login", { loginState });
}
/** Reads quota with the credential the sign-in stored; both sites share the billing route. */
export async function queryZcodeQuota(): Promise<ZcodeAccount> {
  if (!isTauri()) throw new Error("Open QuotaPeek as a desktop app (npm run tauri dev) to read ZCode quota.");
  return invoke<ZcodeAccount>("zcode_query_quota");
}
export function zcodeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return "Could not read ZCode quota. Please retry.";
}
