import { useEffect, useState } from "react";
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
function QuotaWindow({ window: quota, unit, now }: { window: ZcodeWindow; unit: string; now: number }) {
  const [reset, time] = resetText(quota.resetsAt, now, quota.oneTime);
  return <section className="zc-window" aria-label={quota.label}>
    <div className="zc-window-summary"><h3>{quota.label}</h3><span className="zc-window-usage">{count(quota.used)} / {count(quota.total)} {unit}</span></div>
    <progress max={100} value={quota.usedPercent} aria-label={`${quota.label} used`}>{quota.usedPercent}%</progress>
    <div className="zc-window-reset"><span>{reset}</span><span>{time}</span></div>
  </section>;
}
export default function ZcodeAccountCard({ account, active, stale, loading }: { account: ZcodeAccount; active: boolean; stale: boolean; loading: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10000); return () => window.clearInterval(timer); }, []);
  const status = loading ? "Refreshing" : stale ? "Last known data · Refresh failed" : "Last query succeeded";
  const unit = unitLabel(account.windows);
  const aggregate = totals(account.windows);
  const usedPercent = aggregate ? aggregate.used / aggregate.total * 100 : 0;
  const identity = account.email ?? "ZCode account";
  const region = account.region === "global" ? "Global" : "CN";
  const plan = [account.planName ?? "Plan unavailable", account.planDescription].filter(Boolean).join(" · ");
  return <article id={`panel-${account.id}`} role="tabpanel" aria-labelledby={`tab-${account.id}`} aria-hidden={!active} inert={!active} tabIndex={active ? 0 : -1} className="account-card provider-zcode" aria-busy={loading}>
    <div className="account-header">
      <span className="provider-mark" aria-hidden="true">Z</span>
      <div className="account-identity"><h2>ZCode</h2><p title={identity}>{identity} · {region}</p></div>
      <span className={`connection-status${stale ? " is-stale" : ""}`} role="img" aria-label={status} title={status} />
    </div>
    <p className="zc-plan">{plan}{stale ? " · Stale data" : ""}</p>

    <div className="zc-hero">
      <span className="zc-hero-label">{aggregate ? `${unit[0].toUpperCase()}${unit.slice(1)} remaining` : "Quota remaining"}</span>
      <strong className="zc-hero-value">{count(aggregate?.remain ?? null)}{aggregate && <span> {unit}</span>}</strong>
      <span className="zc-hero-sub">{aggregate ? `${percent(usedPercent)}% used · ${count(aggregate.used)} of ${count(aggregate.total)} used` : "No quota bucket reported."}</span>
    </div>
    {aggregate && <progress max={100} value={usedPercent} aria-label="ZCode quota used">{usedPercent}%</progress>}

    {account.windows.length > 0
      ? <div className="zc-windows">{account.windows.map(quota => <QuotaWindow key={quota.key} window={quota} unit={unit} now={now} />)}</div>
      : <p className="zc-empty">No quota buckets reported for this ZCode account.</p>}
  </article>;
}
