import { useEffect, useRef, useState } from "react";
import type { Account } from "../../types/quota";
import { claimableEntries } from "../../lib/activities/activityState";
import type { useActivities } from "../../hooks/useActivities";
import workbuddyIcon from "../../assets/providers/workbuddy/workbuddy.svg";
import zcodeIcon from "../../assets/providers/zcode/zai.png";
import ActivityCampaign from "./ActivityCampaign";
import "./Activities.css";

export type ActivityController = ReturnType<typeof useActivities>;
const providerNames = { workbuddy: "WorkBuddy", zcode: "ZCode" };
const providerIcons = { workbuddy: workbuddyIcon, zcode: zcodeIcon };
function Chevron() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="m15 6-6 6 6 6" />
  </svg>;
}
export default function ActivityPanel({ accounts, controller, onClose }: {
  accounts: readonly Account[]; controller: ActivityController; onClose: () => void;
}) {
  const { activities, demo, claim, claimAll, batchRunning, claimRunning, message, refreshing } = controller;
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { back.current?.focus(); }, []);
  const providers = [...new Set(activities.map(activity => activity.providerId))];
  const [selectedProvider, setSelectedProvider] = useState<(typeof providers)[number] | undefined>(providers[0]);
  const selected = providers.find(provider => provider === selectedProvider) ?? providers[0];
  const campaigns = activities.filter(activity => activity.providerId === selected);
  const page = selected ? providers.indexOf(selected) : 0;
  function move(direction: number) {
    const next = providers[(page + direction + providers.length) % providers.length];
    if (next) setSelectedProvider(next);
  }
  const available = claimableEntries(activities).length;
  return <section id="activities-panel" className="activities-panel" aria-labelledby="activities-heading">
    <h2 id="activities-heading" className="sr-only">Activities</h2>
    {refreshing && <p className="activity-preview-notice" role="status">Checking activities…</p>}
    {message && <p className="activity-feedback" role="status">{message}</p>}
    <div className="activity-controls">
      {controller.configSource && <span className="activity-config-source">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <rect x="4" y="3" width="16" height="7" rx="2" />
          <rect x="4" y="14" width="16" height="7" rx="2" />
          <path d="M8 6.5h.01M8 17.5h.01M12 6.5h4M12 17.5h4" />
        </svg>
        <span>{controller.configSource === "server" ? "Server configuration" : "Local configuration"}</span>
      </span>}
      <div className="activities-toolbar">
        <button type="button" className="activity-bulk" aria-label="Claim all available rewards across all providers" title="Claim all available rewards" disabled={!available || batchRunning || claimRunning || refreshing} onClick={() => void claimAll()}>
          {batchRunning ? "Claiming…" : "Claim all"}
        </button>
        <button type="button" ref={back} className="activities-back" onClick={onClose} aria-label="Back to accounts" title="Back to accounts"><Chevron /></button>
      </div>
    </div>
    <div className="activity-provider-deck">
    <div className="activity-deck-header">
    {providers.length > 0 && <div className="activity-switcher" role="group" aria-label="Select activity provider">
      {providers.map(provider => <button type="button" key={provider} className={`activity-choice provider-${provider}`}
        aria-label={`Select ${providerNames[provider]}`} aria-pressed={provider === selected} title={providerNames[provider]}
        onClick={() => setSelectedProvider(provider)}>
        <img src={providerIcons[provider]} alt="" draggable={false} />
      </button>)}
    </div>}
    </div>
    <div className="activity-list" role="region" aria-label="Activity cards" tabIndex={providers.length > 1 ? 0 : undefined}
      onKeyDown={event => {
        if ((event.target as Element).closest("button")) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}>
      {selected && <article className={`activity-provider-card provider-${selected}`} aria-label={`${providerNames[selected]} activities`}>
        <div className="activity-groups">
          {campaigns.map(activity => <ActivityCampaign key={activity.id} activity={activity} accounts={accounts}
            claim={claim} batchRunning={batchRunning} />)}
        </div>
      </article>}
      {!refreshing && activities.length === 0 && <div className="activities-empty"><span aria-hidden="true">✦</span><strong>No activities to show</strong><p>Rewards for your supported accounts will appear here.</p></div>}
    </div>
    </div>
    {demo && <p className="activity-preview-notice activity-preview-footer">Preview · No real claims</p>}
  </section>;
}
