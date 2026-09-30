import type { Account } from "../types/quota";
import CodexAccountCard from "./providers/CodexAccountCard";
import WorkbuddyAccountCard from "./providers/WorkbuddyAccountCard";
interface AccountCardProps { account: Account; active: boolean; stale: boolean; loading: boolean }
export default function AccountCard(props: AccountCardProps) {
  const { account, active, stale, loading } = props;
  switch (account.providerId) {
    case "codex": return <CodexAccountCard account={account} active={active} stale={stale} loading={loading} />;
    case "workbuddy": return <WorkbuddyAccountCard account={account} active={active} stale={stale} loading={loading} />;
  }
}
