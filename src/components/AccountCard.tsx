import type { Account } from "../types/quota";
import "./AccountCard.css";

interface AccountCardProps {
  account: Account;
  active: boolean;
}

export default function AccountCard({ account, active }: AccountCardProps) {
  return (
    <article id={`panel-${account.id}`} role="tabpanel" aria-labelledby={`tab-${account.id}`} aria-hidden={!active} inert={!active} tabIndex={active ? 0 : -1} className={`account-card provider-${account.providerId}`}>
      <div className="account-header">
        <span className="provider-mark" aria-hidden="true">{account.mark}</span>
        <div className="account-identity"><h2>{account.provider}</h2><p title={account.email}>{account.email}</p></div>
        <span className="connection-status" role="img" aria-label="Connected (demo)" title="Connected (demo)" />
      </div>
      <div className="limits">{account.limits.map(limit => <section className="limit" key={limit.label} aria-label={limit.label}>
        <div className="limit-summary"><h3>{limit.label}</h3><div className="quota-value"><strong>{limit.remaining}<span>%</span></strong><span className="remaining-label">remaining</span></div></div>
        <progress max={100} value={limit.remaining} aria-label={`${account.provider} ${limit.label} remaining`}>{limit.remaining}%</progress>
        <div className="reset-details"><span>{limit.reset}</span><span>{limit.time} left</span></div>
      </section>)}</div>
    </article>
  );
}
