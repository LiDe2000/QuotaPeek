import type { Account } from "../types/quota";
import CodexAccountCard from "./providers/CodexAccountCard";
interface AccountCardProps { account: Account; active: boolean; stale: boolean; loading: boolean }
export default function AccountCard(props: AccountCardProps) {
  switch (props.account.providerId) {
    case "codex": return <CodexAccountCard {...props} />;
  }
}
