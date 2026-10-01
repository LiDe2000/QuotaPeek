import type { CodexAccount } from "./codex";
import type { WorkbuddyAccount } from "./workbuddy";
import type { ZcodeAccount } from "./zcode";
// Extend this discriminated union when another provider is implemented.
// Provider-specific quota fields belong to that provider's own type.
export type Account = CodexAccount | WorkbuddyAccount | ZcodeAccount;
export function accountLabel(account: Account): string | null {
  if (account.providerId === "workbuddy") return account.nickname;
  return account.email;
}
