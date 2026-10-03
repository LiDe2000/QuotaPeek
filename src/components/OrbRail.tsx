import { useRef } from "react";
import type { KeyboardEvent } from "react";
import type { Account } from "../types/quota";
import type { ProviderGroup, Provider } from "../lib/providerGroups";
import { accountLabel } from "../types/quota";
import { providerIcon } from "../lib/providerIcons";
import { orbMeter } from "../lib/orb";
import { providerName } from "../lib/providerGroups";
import { useProviderReorder } from "../hooks/useProviderReorder";
import "./OrbRail.css";

const names = providerName;
const marks: Record<Account["providerId"], string> = { codex: "O", workbuddy: "W", zcode: "Z", deepseek: "D" };

interface OrbRailProps {
  groups: readonly ProviderGroup[];
  selectedProvider?: Provider;
  /** Whether a popup card is open beside the rail. */
  cardOpen: boolean;
  refreshingIds: readonly string[];
  onToggleHome(): void;
  onHover(provider: Provider): void;
  onLeave(): void;
  onRefresh(accountId: string): void;
  onAddAccount(): void;
  onReorder(source: Provider, target: Provider): void;
  onReorderPress(): void;
}

export default function OrbRail({ groups, selectedProvider, cardOpen, refreshingIds, onToggleHome, onHover, onLeave, onRefresh, onAddAccount, onReorder, onReorderPress }: OrbRailProps) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const reorder = useProviderReorder("y", onReorder, onReorderPress);
  function navigate(event: KeyboardEvent<HTMLElement>) {
    if (!groups.length || !event.target || !(event.target as Element).closest("[data-provider]")) return;
    const focused = tabs.current.findIndex(node => node === document.activeElement);
    const page = Math.max(0, focused);
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (page + 1) % groups.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (page + groups.length - 1) % groups.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = groups.length - 1;
    else return;
    event.preventDefault();
    tabs.current[next]?.focus();
  }
  return <nav
    ref={reorder.container}
    className="orb-rail"
    aria-label="Provider rings"
    onKeyDown={navigate}
  >
    <button type="button" className="orb-ring is-main" aria-expanded={cardOpen} aria-label={cardOpen ? "Collapse QuotaPeek" : "Expand QuotaPeek"} title={cardOpen ? "Collapse" : "Expand QuotaPeek"} onClick={onToggleHome}>
      <img className="orb-logo" src={`${import.meta.env.BASE_URL}quotapeek.svg`} alt="" draggable={false} />
    </button>
    <div className="orb-section-divider" aria-hidden="true" />
      {groups.map((group, index) => {
        const account = group.selected;
        const icon = providerIcon(account.providerId);
        const meter = orbMeter(account);
        const active = cardOpen && selectedProvider === group.providerId;
        const refreshing = refreshingIds.includes(account.id);
        // Green while there is room, amber as it thins, red near the ceiling — like Pulse.
        const level = meter.percent === null ? "is-idle" : meter.percent <= 15 ? "is-hot" : meter.percent <= 40 ? "is-warn" : "is-ok";
        const circumference = 2 * Math.PI * 19;
        return <button
          key={group.providerId}
          ref={node => { tabs.current[index] = node; }}
          type="button"
          id={`provider-${group.providerId}`}
          {...reorder.itemProps(group.providerId)}
          aria-current={active ? "true" : undefined}
          aria-busy={refreshing}
          aria-description="Click to refresh. Hover to preview. Hold and drag to reorder, or use Alt+Up/Down."
          aria-controls={`panel-${account.id}`}
          className={`orb-ring ${level}${active ? " is-active" : ""}${refreshing ? " is-refreshing" : ""}`}
            aria-label={`${names[account.providerId]}${accountLabel(account) ? ` · ${accountLabel(account)}` : ""}`}
          onMouseEnter={() => { if (!reorder.isPressed()) onHover(group.providerId); }}
          onMouseLeave={onLeave}
          onFocus={event => { if (event.currentTarget.matches(":focus-visible")) onHover(group.providerId); }}
          onBlur={event => { if (!(event.relatedTarget as Element | null)?.closest(".orb-float, .orb-ring[data-provider]")) onLeave(); }}
          onClick={() => onRefresh(account.id)}
        >
          <svg viewBox="0 0 44 44" aria-hidden="true">
            <circle className="orb-track" cx="22" cy="22" r="19" />
            <circle
              className="orb-value"
              cx="22"
              cy="22"
              r="19"
              strokeDasharray={circumference}
              strokeDashoffset={meter.percent === null ? circumference : circumference * (1 - meter.percent / 100)}
            />
          </svg>
          {icon
            ? <img className="orb-logo" src={icon} alt="" draggable={false} />
            : <span className={`orb-logo provider-${account.providerId}`} aria-hidden="true">{marks[account.providerId]}</span>}
          {account.providerId === "deepseek" && account.fetchedAt > 0 && <span className={`orb-balance-status${account.isAvailable ? "" : " is-empty"}`} role="img" aria-label={account.isAvailable ? "Balance available" : "No available balance"} />}
        </button>;
      })}
    <button type="button" className="orb-ring is-add" aria-label="Add account" title="Add account" onClick={onAddAccount}>
      <span className="orb-plus" aria-hidden="true">+</span>
    </button>
  </nav>;
}
