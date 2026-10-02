import type { Account } from "../types/quota";
import { accountLabel } from "../types/quota";
import CodexAccountCard from "./providers/CodexAccountCard";
import WorkbuddyAccountCard from "./providers/WorkbuddyAccountCard";
import ZcodeAccountCard from "./providers/ZcodeAccountCard";
import DeepseekAccountCard from "./providers/DeepseekAccountCard";
import { providerName } from "../lib/providerGroups";
interface AccountCardProps { account: Account; active: boolean; stale: boolean; loading: boolean; preview?: boolean }
export default function AccountCard(props: AccountCardProps) {
  const { account, active, stale, loading, preview = false } = props;
  const panelId = `${preview ? "preview" : "panel"}-${account.id}`;
  if (!account.fetchedAt) return <article id={panelId} className={`account-card provider-${account.providerId}`} aria-busy={loading}>
    <div className="account-header"><div className="account-identity"><h2>{providerName[account.providerId]}</h2><p>{accountLabel(account) ?? "Connected account"}</p></div></div>
    <p className="account-hint">{loading ? "Reading quota…" : stale ? "Quota query failed. Refresh to retry." : "Waiting for the first quota query…"}</p>
  </article>;
  switch (account.providerId) {
    case "deepseek": return <DeepseekAccountCard account={account} active={active} stale={stale} loading={loading} panelId={panelId} />;
    case "codex": return <CodexAccountCard account={account} active={active} stale={stale} loading={loading} panelId={panelId} />;
    case "workbuddy": return <WorkbuddyAccountCard account={account} active={active} stale={stale} loading={loading} panelId={panelId} />;
    case "zcode": return <ZcodeAccountCard account={account} active={active} stale={stale} loading={loading} panelId={panelId} />;
  }
}
