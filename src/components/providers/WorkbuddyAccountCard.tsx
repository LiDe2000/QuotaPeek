import { useEffect, useState } from "react";
import type { WorkbuddyAccount, WorkbuddyPackage } from "../../types/workbuddy";
import "../AccountCard.css";
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
export default function WorkbuddyAccountCard({ account, active, stale, loading, defaultExpanded = false }: { account: WorkbuddyAccount; active: boolean; stale: boolean; loading: boolean; defaultExpanded?: boolean }) {
  const [now, setNow] = useState(Date.now);
  const [expanded, setExpanded] = useState(defaultExpanded);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10000); return () => window.clearInterval(timer); }, []);
  const status = loading ? "Refreshing" : stale ? "Last known data · Refresh failed" : "Last query succeeded";
  const region = account.region === "global" ? "Global" : "CN";
  const usedPercent = account.totalSize > 0 ? Math.min(100, account.totalUsed / account.totalSize * 100) : 0;
  const identity = account.nickname || account.uid || "WorkBuddy account";
  return <article id={`panel-${account.id}`} role="tabpanel" aria-labelledby={`tab-${account.id}`} aria-hidden={!active} inert={!active} tabIndex={active ? 0 : -1} className="account-card provider-workbuddy" aria-busy={loading}>
    <div className="account-header">
      <span className="provider-mark" aria-hidden="true">W</span>
      <div className="account-identity"><h2>WorkBuddy</h2><p title={identity}>{identity} · {region}</p></div>
      <span className={`connection-status${stale ? " is-stale" : ""}`} role="img" aria-label={status} title={status} />
    </div>

    <div className={`wb-deck${expanded ? " is-expanded" : ""}`}>
      <button type="button" className="wb-balance" aria-expanded={expanded} aria-controls="workbuddy-packages" onClick={() => setExpanded(open => !open)}>
        <span className="wb-balance-shine" aria-hidden="true" />
        <span className="wb-balance-label">Credits balance</span>
        <strong className="wb-balance-value">{credits.format(account.totalRemain)}<span> credits</span></strong>
        <span className="wb-balance-sub">{credits.format(account.totalUsed)} of {credits.format(account.totalSize)} used · {account.packages.length} {account.packages.length === 1 ? "package" : "packages"}</span>
        <span className="wb-balance-hint">{expanded ? "Hide breakdown" : "View breakdown"}</span>
      </button>
    </div>
    <progress max={100} value={usedPercent} aria-label="WorkBuddy credits used">{usedPercent}%</progress>

    {expanded && <ul id="workbuddy-packages" className="wb-packages">
      {account.packages.map((pkg, index) => {
        const badge = expiryBadge(pkg, now);
        const used = pkg.size > 0 ? Math.min(100, pkg.used / pkg.size * 100) : 0;
        return <li className="wb-package" key={index}>
          <div className="wb-package-summary">
            <span className="wb-package-name" title={pkg.name}>{pkg.name}</span>
            {badge && <span className={`wb-package-badge${badge === "Expired" ? " is-expired" : ""}`}>{badge}</span>}
            <span className="wb-package-usage">{credits.format(pkg.used)}/{credits.format(pkg.size)}</span>
          </div>
          <progress max={100} value={used} aria-label={`${pkg.name} used`}>{used}%</progress>
          <p className="wb-package-expiry">{expiryText(pkg)}</p>
        </li>;
      })}
      {account.packages.length === 0 && <li className="wb-packages-empty">No credit packages reported.</li>}
    </ul>}
  </article>;
}
