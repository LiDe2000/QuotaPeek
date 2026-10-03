import type { CodexAccount } from "./providers/codex";
import type { WorkbuddyAccount } from "./providers/workbuddy";
import type { ZcodeAccount } from "./providers/zcode";
import type { DeepseekAccount } from "./providers/deepseek";
// Extend this discriminated union when another provider is implemented.
// Provider-specific quota fields belong to that provider's own type.
export type Account = CodexAccount | WorkbuddyAccount | ZcodeAccount | DeepseekAccount;
export function accountLabel(account: Account): string | null {
  if (account.providerId === "deepseek") return account.label;
  if (account.providerId === "workbuddy") return account.nickname ?? account.uid;
  return account.email;
}
