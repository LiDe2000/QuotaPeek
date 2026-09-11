import type { Account } from "../components/AccountCard";

export const accounts = [
  { id: "codex", provider: "OpenAI Codex", mark: "O", email: "user@example.com", limits: [
    { label: "5 Hour Limit", remaining: 85, reset: "Resets at 17:08", time: "2h 37m" },
    { label: "Weekly Limit", remaining: 83, reset: "Resets Sep 15", time: "4d 8h" },
  ] },
  { id: "claude", provider: "Claude", mark: "C", email: "personal@sample.dev", limits: [
    { label: "5 Hour Limit", remaining: 64, reset: "Resets at 16:42", time: "2h 11m" },
    { label: "Weekly Limit", remaining: 71, reset: "Resets Sep 16", time: "5d 9h" },
  ] },
] as const satisfies readonly Account[];
