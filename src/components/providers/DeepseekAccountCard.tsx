import { formatMoney } from "../../lib/money";
import type { ReactNode } from "react";
import type { DeepseekAccount } from "../../types/deepseek";
import deepseekAvatar from "../../assets/models/deepseek/avatar.png";
import "../AccountCard.css";
import "./DeepseekAccountCard.css";

export default function DeepseekAccountCard({ account, active, stale, loading, panelId, actions }: {
  account: DeepseekAccount; active: boolean; stale: boolean; loading: boolean; panelId: string; actions?: ReactNode;
}) {
  const status = loading ? "Refreshing" : stale ? "Last known data · Refresh failed"
    : account.isAvailable ? "Balance available" : "No available balance";
  return <article id={panelId} role="region" aria-label={`DeepSeek · ${account.label} balance`} aria-hidden={!active} inert={!active} tabIndex={active ? 0 : -1} className="account-card provider-deepseek" aria-busy={loading}>
    <div className="account-header">
      <span className="provider-mark provider-portrait" aria-hidden="true"><img src={deepseekAvatar} alt="" draggable={false} /></span>
      <div className="account-identity"><h2>DeepSeek</h2><p title={account.contact ? `${account.label} · ${account.contact}` : account.label}>{account.label}{account.contact ? ` · ${account.contact}` : account.source === "deepseek-api" ? " · API" : ""}</p></div>
      <span className={`connection-status${stale ? " is-stale" : ""}${account.isAvailable ? "" : " ds-unavailable"}`} role="img" aria-label={status} title={status} />
      {actions}
    </div>
    {account.balances.map((balance, index) => <section className="ds-deck" aria-label={`${balance.currency} balance`} key={`${balance.currency}-${index}`}>
      <div className="ds-balance-heading"><span>Available balance</span><span>{balance.currency}</span></div>
      <div className="ds-balance"><strong>{formatMoney(balance.total_balance, balance.currency)}</strong></div>
      <dl className="ds-wallets">
        <div><dt title="Topped-up balance">Top-up</dt><dd>{formatMoney(balance.topped_up_balance, balance.currency)}</dd></div>
        <div><dt title="Total spent">Spent</dt><dd>{balance.total_cost != null ? formatMoney(balance.total_cost, balance.currency) : <span className="ds-unknown" title="Total spending is not available for this account">—</span>}</dd></div>
        <div><dt title="Granted balance">Bonus</dt><dd>{formatMoney(balance.granted_balance, balance.currency)}</dd></div>
      </dl>
    </section>)}
    {!account.isAvailable && <p className="ds-billing-note">No available balance · Top up to continue</p>}
  </article>;
}
