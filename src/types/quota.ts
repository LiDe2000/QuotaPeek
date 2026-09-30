import type { CodexAccount } from "./codex";
import type { WorkbuddyAccount } from "./workbuddy";
// Extend this discriminated union when another provider is implemented.
// Provider-specific quota fields belong to that provider's own type.
export type Account = CodexAccount | WorkbuddyAccount;
export function accountLabel(account: Account): string | null {
  return account.providerId === "codex" ? account.email : account.nickname;
}
