import { useEffect, useState } from "react";
import gptAvatar from "../../assets/models/gpt/avatar.png";
import type { CodexAccount, CodexRateLimitWindow } from "../../types/codex";
import "../AccountCard.css";
import "./CodexAccountCard.css";

export function windowLabel(minutes: number | null, fallback: string): string {
  if (minutes === null || minutes <= 0) return fallback;
  if (minutes === 10080) return "Weekly Limit";
  if (minutes % 1440 === 0) return `${minutes / 1440} Day Limit`;
  if (minutes % 60 === 0) return `${minutes / 60} Hour Limit`;
  return `${minutes} Minute Limit`;
}
function resetTime(timestamp: number | null, now: number) {
  if (timestamp === null || !Number.isFinite(timestamp)) return ["Reset time unavailable", ""];
  const date = new Date(timestamp * 1000);
  if (!Number.isFinite(date.getTime())) return ["Reset time unavailable", ""];
  const minutes = Math.ceil((timestamp * 1000 - now) / 60000);
  const remaining = minutes <= 0 ? "Refresh to check reset" : minutes >= 1440 ? `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h remaining` : `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
  // Fixed MM-DD HH:MM in local time, so the stamp never depends on the system locale.
  const pad = (value: number) => String(value).padStart(2, "0");
  return [`Resets ${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`, remaining];
}
function QuotaWindow({ value, fallback, now }: { value: CodexRateLimitWindow; fallback: string; now: number }) {
  const label = windowLabel(value.windowDurationMins, fallback);
  const remaining = Math.max(0, Math.min(100, 100 - value.usedPercent));
  const [reset, time] = resetTime(value.resetsAt, now);
  return <section className="limit" aria-label={label}>
    <div className="limit-summary"><h3>{label}</h3><div className="quota-value"><strong>{Number(remaining.toFixed(1))}<span>%</span></strong></div></div>
    <progress max={100} value={remaining} aria-label={`Codex ${label} remaining`}>{remaining}%</progress>
    <div className="reset-details"><span>{reset}</span><span>{time}</span></div>
  </section>;
}
function TokenStats({ usage }: { usage: CodexAccount["tokenUsage"] }) {
  const number = (value: number | null | undefined) => value === null || value === undefined ? "—" : new Intl.NumberFormat().format(value);
  const latestDate = usage?.latestDailyDate ?? null;
  const showingLatest = usage?.todayTokens == null && usage?.latestDailyTokens != null && latestDate !== null;
  const dailyLabel = showingLatest && latestDate ? `Latest · ${latestDate.slice(5)}` : "Today";
  const dailyTokens = showingLatest ? usage?.latestDailyTokens : usage?.todayTokens;
  return <section className="codex-tokens" aria-label="Codex account token usage" title="Reported by Codex account/usage/read. Today matches the calendar date in US Pacific time.">
    <div className="codex-tokens-heading"><h3>TOKEN USAGE</h3><span>US Pacific day</span></div>
    <div className="codex-tokens-values">
      <div><span>Total</span><strong>{number(usage?.lifetimeTokens)}</strong></div>
      <div title={showingLatest ? `Latest daily usage: ${latestDate}` : undefined}><span>{dailyLabel}</span><strong>{number(dailyTokens)}</strong></div>
    </div>
    {usage?.todayTokens === null && <p className="codex-tokens-unavailable">{showingLatest ? `Today's usage pending · Showing ${latestDate}` : "Today's daily usage has not been reported"}</p>}
    {!usage && <p className="codex-tokens-unavailable">Token usage unavailable from Codex</p>}
  </section>;
}
export default function CodexAccountCard({ account, active, stale, loading, panelId }: { account: CodexAccount; active: boolean; stale: boolean; loading: boolean; panelId?: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10000); return () => window.clearInterval(timer); }, []);
  const status = loading ? "Refreshing" : stale ? "Last known data · Refresh failed" : "Last query succeeded";
  return <article id={panelId ?? `panel-${account.id}`} role="region" aria-label={`${account.providerId} · ${account.id} quota`} aria-hidden={!active} inert={!active} tabIndex={active ? 0 : -1} className="account-card provider-codex" aria-busy={loading}>
    <div className="account-header">
      <span className="provider-mark provider-portrait" aria-hidden="true"><img src={gptAvatar} alt="" draggable={false} /></span>
      <div className="account-identity"><h2>Codex</h2><p title={account.email ?? "Email unavailable"}>{account.email ?? "Local Codex account"}</p></div>
      <span className={`connection-status${stale ? " is-stale" : ""}`} role="img" aria-label={status} title={status} />
    </div>
    <p className="codex-plan">{account.planType ?? "Plan unavailable"} · Local account{stale ? " · Stale data" : ""}</p>
    {Object.entries(account.rateLimits).map(([id, bucket]) => <div className="codex-bucket" key={id}>
      {(Object.keys(account.rateLimits).length > 1 || id !== "codex") && <h3 className="codex-bucket-title">{bucket.limitName ?? id}</h3>}
      <div className="limits">
        {bucket.primary && <QuotaWindow value={bucket.primary} fallback="Primary Limit" now={now} />}
        {bucket.secondary && <QuotaWindow value={bucket.secondary} fallback="Secondary Limit" now={now} />}
        {!bucket.primary && !bucket.secondary && <p className="account-hint">No quota windows reported.</p>}
      </div>
      {bucket.individualLimit && <div className="codex-credit"><span>Individual spending limit</span><span>{bucket.individualLimit.remainingPercent}% remaining</span></div>}
      {bucket.credits && (bucket.credits.unlimited || bucket.credits.hasCredits) && <div className="codex-credit"><span>Credits</span><span>{bucket.credits.unlimited ? "Unlimited" : bucket.credits.balance ?? "Balance unavailable"}</span></div>}
    </div>)}
    <TokenStats usage={account.tokenUsage} />
  </article>;
}
