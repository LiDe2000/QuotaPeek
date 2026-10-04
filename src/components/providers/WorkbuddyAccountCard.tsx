import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import workbuddyAvatar from "../../assets/models/workbuddy/avatar.svg";
import type { WorkbuddyAccount, WorkbuddyPackage } from "../../types/providers/workbuddy";
import { quotaLevel } from "../../lib/quota/level";
import "../accounts/AccountCard.css";
import "./WorkbuddyAccountCard.css";

/** Parses the billing API's "YYYY-MM-DD HH:mm:ss" stamp as local time. */
export function parseExpiry(endTime: string | null): number | null {
  if (!endTime) return null;
  const stamp = Date.parse(endTime.replace(" ", "T"));
  return Number.isFinite(stamp) ? stamp : null;
}
function expiryBadge(pkg: WorkbuddyPackage, now: number): string | null {
  const expires = parseExpiry(pkg.endTime);
  if (expires === null) return null;
  const hours = (expires - now) / 3600000;
  if (hours <= 0) return "Expired";
  if (hours <= 24) return "Expires in 24h";
  return null;
}
function expiryText(pkg: WorkbuddyPackage): string {
  return pkg.endTime ? `Expires ${pkg.endTime.slice(0, 16)}` : "No expiry reported";
}
// Credits carry fractions from the API's precise fields; integers stay bare (1,871), the rest show up to 2 decimals (1,869.69).
const credits = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
/** One decimal at most, without a trailing ".0". */
function percent(value: number): string {
  return String(Number(value.toFixed(1)));
}
export default function WorkbuddyAccountCard({ account, active, stale, loading, defaultExpanded = false, panelId, actions }: { account: WorkbuddyAccount; active: boolean; stale: boolean; loading: boolean; defaultExpanded?: boolean; panelId?: string; actions?: ReactNode }) {
  const [now, setNow] = useState(Date.now);
  const [expanded, setExpanded] = useState(defaultExpanded);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10000); return () => window.clearInterval(timer); }, []);
  const status = loading ? "Refreshing" : stale ? "Last known data · Refresh failed" : "Last query succeeded";
  const region = account.region === "global" ? "Global" : "CN";
  const usedPercent = account.totalSize > 0 ? Math.min(100, account.totalUsed / account.totalSize * 100) : 0;
  const remainingPercent = account.totalSize > 0 ? 100 - usedPercent : null;
  // No reported allowance means no percentage to claim, rather than a made-up 100%.
  const remainPercent = remainingPercent === null ? null : percent(remainingPercent);
  const identity = account.nickname || account.uid || "WorkBuddy account";
  return <article id={panelId ?? `panel-${account.id}`} role="region" aria-label={`${account.providerId} · ${account.id} quota`} aria-hidden={!active} inert={!active} tabIndex={active ? 0 : -1} className="account-card provider-workbuddy" aria-busy={loading}>
    <div className="account-header">
      <span className="provider-mark provider-portrait" aria-hidden="true"><img src={workbuddyAvatar} alt="" draggable={false} /></span>
      <div className="account-identity"><h2>WorkBuddy</h2><p title={identity}>{identity} · {region}</p></div>
      <span className={`connection-status${stale ? " is-stale" : ""}`} role="img" aria-label={status} title={status} />
      {actions}
    </div>

    {/* One card holds the balance and the overall bar; a click anywhere on it — mouse on the
        deck, keyboard on the button — expands the breakdown. */}
    <div className={`wb-deck${expanded ? " is-expanded" : ""}`} data-quota={quotaLevel(remainingPercent)} onClick={() => setExpanded(open => !open)}>
      <button type="button" className="wb-balance" aria-expanded={expanded} aria-controls={`workbuddy-packages-${panelId ?? account.id}`}>
        <span className="wb-balance-shine" aria-hidden="true" />
        <span className="wb-balance-label">Credits balance</span>
        <strong className="wb-balance-value">{credits.format(account.totalRemain)}<span> credits</span></strong>
        <span className="wb-balance-hint">{expanded ? "Hide breakdown" : "View breakdown"}</span>
      </button>
      {/* The bar carries its own caption: what the total is made of above, what is still left below. */}
      <div className="wb-total">
        <span>{account.packages.length} {account.packages.length === 1 ? "package" : "packages"}</span>
        <span>{credits.format(account.totalUsed)}/{credits.format(account.totalSize)}</span>
      </div>
      <progress max={100} value={remainingPercent ?? 0} aria-label="WorkBuddy credits remaining">{remainingPercent ?? 0}%</progress>
      {remainPercent !== null && <div className="wb-remaining">Remaining: {remainPercent}%</div>}
    </div>

    {expanded && <ul id={`workbuddy-packages-${panelId ?? account.id}`} className="wb-packages">
      {account.packages.map((pkg, index) => {
        const badge = expiryBadge(pkg, now);
        const used = pkg.size > 0 ? Math.min(100, pkg.used / pkg.size * 100) : 0;
        const remain = pkg.size > 0 ? 100 - used : null;
        return <li className="wb-package" key={index} data-quota={quotaLevel(remain)}>
          <div className="wb-package-summary">
            <span className="wb-package-name" title={pkg.name}>{pkg.name}</span>
            <span className="wb-package-usage">{credits.format(pkg.used)}/{credits.format(pkg.size)}</span>
          </div>
          <progress max={100} value={remain ?? 0} aria-label={`${pkg.name} remaining`}>{remain ?? 0}%</progress>
          {/* The urgency flag rides with the expiry stamp: it says the same thing as the row's own line, so it must not compete with the package name for width. */}
          <p className="wb-package-expiry">
            <span>{expiryText(pkg)}</span>
            {badge && <span className={`wb-package-badge${badge === "Expired" ? " is-expired" : ""}`}>{badge}</span>}
          </p>
        </li>;
      })}
      {account.packages.length === 0 && <li className="wb-packages-empty">No credit packages reported.</li>}
    </ul>}
  </article>;
}
