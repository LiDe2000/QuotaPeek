import type { Account } from "../types/quota";
import { accountLabel } from "../types/quota";
import CodexAccountCard from "./providers/CodexAccountCard";
import WorkbuddyAccountCard from "./providers/WorkbuddyAccountCard";
import ZcodeAccountCard from "./providers/ZcodeAccountCard";
import DeepseekAccountCard from "./providers/DeepseekAccountCard";
import { providerName } from "../lib/providerGroups";
import AccountActions from "./AccountActions";
interface AccountCardProps { account: Account; active: boolean; stale: boolean; loading: boolean; preview?: boolean; removalDisabled?: boolean; onRemove?: () => Promise<boolean> }
export default function AccountCard(props: AccountCardProps) {
  const { account, active, stale, loading, preview = false } = props;
  const panelId = `${preview ? "preview" : "panel"}-${account.id}`;
  const actions = !preview && props.onRemove ? <AccountActions account={account} disabled={!!props.removalDisabled} onRemove={props.onRemove} /> : undefined;
  if (!account.fetchedAt) return <article id={panelId} className={`account-card provider-${account.providerId}`} aria-busy={loading}>
    <div className="account-header"><div className="account-identity"><h2>{providerName[account.providerId]}</h2><p>{accountLabel(account) ?? "Connected account"}</p></div>{actions}</div>
    <p className="account-hint">{loading ? "Reading quota…" : stale ? "Quota query failed. Refresh to retry." : "Waiting for the first quota query…"}</p>
  </article>;
  switch (account.providerId) {
    case "deepseek": return <DeepseekAccountCard account={account} active={active} stale={stale} loading={loading} panelId={panelId} actions={actions} />;
    case "codex": return <CodexAccountCard account={account} active={active} stale={stale} loading={loading} panelId={panelId} actions={actions} />;
    case "workbuddy": return <WorkbuddyAccountCard account={account} active={active} stale={stale} loading={loading} panelId={panelId} actions={actions} />;
    case "zcode": return <ZcodeAccountCard account={account} active={active} stale={stale} loading={loading} panelId={panelId} actions={actions} />;
  }
}
