import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import glmAvatar from "../../assets/models/glm/avatar.png";
import type { ZcodeAccount, ZcodeWindow } from "../../types/zcode";
import "../AccountCard.css";
import "./ZcodeAccountCard.css";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/** Token ceilings run into hundreds of millions; plain digits would overflow the row. */
function count(value: number | null): string {
  return value === null ? "—" : Math.abs(value) >= 1_000_000 ? compact.format(value) : plain.format(value);
}
/** One decimal at most, without a trailing ".0". */
function percent(value: number): string {
  return String(Number(value.toFixed(1)));
}
function unitLabel(windows: ZcodeWindow[]): string {
  const unit = windows.find(window => window.unit)?.unit ?? "unit";
  return unit.endsWith("s") ? unit : `${unit}s`;
}
/** Sums every bucket that reports both an allowance and what has been spent. */
function totals(windows: ZcodeWindow[]): { used: number; total: number; remain: number } | null {
  let used = 0;
  let total = 0;
  let seen = false;
  for (const window of windows) {
    if (window.used === null || window.total === null || window.total <= 0) continue;
    used += window.used;
    total += window.total;
    seen = true;
  }
  return seen ? { used, total, remain: Math.max(0, total - used) } : null;
}
/** Fixed MM-DD HH:MM in local time, so the stamp never depends on the system locale. */
export function resetText(resetsAt: number | null, now: number, oneTime: boolean): [string, string] {
  const fallback = oneTime ? "Expiry unavailable" : "Reset time unavailable";
  if (resetsAt === null || !Number.isFinite(resetsAt)) return [fallback, ""];
  const date = new Date(resetsAt);
  if (!Number.isFinite(date.getTime())) return [fallback, ""];
  const minutes = Math.ceil((resetsAt - now) / 60000);
  const remaining = minutes <= 0
    ? (oneTime ? "Expired" : "Refresh to check reset")
    : minutes >= 1440
      ? `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h remaining`
      : `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return [`${oneTime ? "Expires" : "Resets"} ${stamp}`, remaining];
}
export default function ZcodeAccountCard({ account, active, stale, loading, defaultExpanded = false, panelId, actions }: { account: ZcodeAccount; active: boolean; stale: boolean; loading: boolean; defaultExpanded?: boolean; panelId?: string; actions?: ReactNode }) {
  const [now, setNow] = useState(Date.now);
  const [expanded, setExpanded] = useState(defaultExpanded);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10000); return () => window.clearInterval(timer); }, []);
  const status = loading ? "Refreshing" : stale ? "Last known data · Refresh failed" : "Last query succeeded";
  const unit = unitLabel(account.windows);
  const aggregate = totals(account.windows);
  const usedPercent = aggregate ? Math.min(100, aggregate.used / aggregate.total * 100) : 0;
  // Nothing to break down means the deck stops pretending to be a toggle.
  const expandable = account.windows.length > 0;
  const identity = account.email ?? "ZCode account";
  const region = account.region === "global" ? "Global" : "CN";
  const plan = [account.planName ?? "Plan unavailable", account.planDescription].filter(Boolean).join(" · ");
  return <article id={panelId ?? `panel-${account.id}`} role="region" aria-label={`${account.providerId} · ${account.id} quota`} aria-hidden={!active} inert={!active} tabIndex={active ? 0 : -1} className="account-card provider-zcode" aria-busy={loading}>
    <div className="account-header">
      <span className="provider-mark provider-portrait" aria-hidden="true"><img src={glmAvatar} alt="" draggable={false} /></span>
      <div className="account-identity"><h2>ZCode</h2><p title={identity}>{identity} · {region}</p></div>
      <span className={`connection-status${stale ? " is-stale" : ""}`} role="img" aria-label={status} title={status} />
      {actions}
    </div>
    <p className="zc-plan">{plan}{stale ? " · Stale data" : ""}</p>

    {/* Same deck as the WorkBuddy card: the remaining figure and the overall bar share one
        frame, and a click anywhere on it — mouse on the deck, keyboard on the button — expands
        the per-model breakdown. */}
    <div
      className={`zc-deck${expanded ? " is-expanded" : ""}${expandable ? "" : " is-static"}`}
      onClick={expandable ? () => setExpanded(open => !open) : undefined}
    >
      <button type="button" className="zc-balance" aria-expanded={expandable ? expanded : undefined} aria-controls={expandable ? `zcode-windows-${panelId ?? account.id}` : undefined}>
        <span className="zc-balance-shine" aria-hidden="true" />
        <span className="zc-balance-label">{aggregate ? `${unit[0].toUpperCase()}${unit.slice(1)} remaining` : "Quota remaining"}</span>
        <strong className="zc-balance-value">{count(aggregate?.remain ?? null)}{aggregate && <span> {unit}</span>}</strong>
        {expandable && <span className="zc-balance-hint">{expanded ? "Hide breakdown" : "View breakdown"}</span>}
      </button>
      {/* The bar carries its own caption: the used/total split above it, the share left below. */}
      {aggregate
        ? <>
            <div className="zc-total"><span>{count(aggregate.used)}/{count(aggregate.total)}</span></div>
            <progress max={100} value={usedPercent} aria-label="ZCode quota used">{usedPercent}%</progress>
            <div className="zc-remaining">Remaining: {percent(100 - usedPercent)}%</div>
          </>
        : <span className="zc-deck-sub">No quota bucket reported.</span>}
    </div>

    {expanded && expandable && <ul id={`zcode-windows-${panelId ?? account.id}`} className="zc-windows">
      {account.windows.map(quota => {
        const [reset, time] = resetText(quota.resetsAt, now, quota.oneTime);
        return <li className="zc-window" key={quota.key}>
          <div className="zc-window-summary">
            <span className="zc-window-name" title={quota.label}>{quota.label}</span>
            <span className="zc-window-usage">{count(quota.used)}/{count(quota.total)}</span>
          </div>
          <progress max={100} value={quota.usedPercent} aria-label={`${quota.label} used`}>{quota.usedPercent}%</progress>
          <p className="zc-window-reset"><span>{reset}</span><span>{time}</span></p>
        </li>;
      })}
    </ul>}
  </article>;
}
