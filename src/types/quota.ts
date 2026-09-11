import type { CodexAccount } from "./codex";
// Extend this discriminated union when another provider is implemented.
// Provider-specific quota fields belong to that provider's own type.
export type Account = CodexAccount;
