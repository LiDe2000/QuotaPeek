import type { Account } from "../../types/quota";
import { accountLabel } from "../../types/quota";
import type { Activity, ActivityStatus } from "../../lib/activities/activityState";
import workbuddyAvatar from "../../assets/models/workbuddy/avatar.svg";
import glmAvatar from "../../assets/models/glm/avatar.png";

const accountAvatars = { workbuddy: workbuddyAvatar, zcode: glmAvatar };

const statusLabel: Record<ActivityStatus, string> = {
  unknown: "Status unknown", available: "Not claimed", claiming: "Claiming…", claimed: "Claimed",
  verification: "Verification needed", failed: "Failed", pending: "Unconfirmed",
};

export default function ActivityCampaign({ activity, accounts, claim, batchRunning }: {
  activity: Activity;
  accounts: readonly Account[];
  claim: (activityId: string, accountId: string) => Promise<void>;
  batchRunning: boolean;
}) {
  return <section aria-label={activity.title} className="activity-campaign">
    <header className="activity-campaign-header"><h3 title={[activity.reward, activity.description].filter(Boolean).join(" · ")}>{activity.title}</h3></header>
    <ul className="activity-accounts">
      {activity.entries.map(entry => {
        const account = accounts.find(item => item.id === entry.accountId);
        const available = entry.status === "available";
        const claimed = entry.status === "claimed";
        const name = account ? accountLabel(account) ?? "Connected account" : "Disconnected account";
        const explanation = [statusLabel[entry.status], entry.note].filter(Boolean).join(" · ");
        return <li key={entry.accountId}>
          <div className="activity-account-info">
            <img className="activity-account-avatar" src={accountAvatars[activity.providerId]} alt="" draggable={false} />
            <strong title={name}>{name}</strong>
          </div>
          <span className={`activity-state-marker is-${entry.status}`} role="img" aria-live="polite" aria-label={explanation} title={explanation}>
            <span aria-hidden="true" />
          </span>
          <button type="button" className={available ? "activity-claim" : "activity-row-action"} disabled={!available || batchRunning}
            title={explanation} aria-label={`${claimed ? "Claimed" : "Claim"} rewards for ${name}`}
            onClick={() => void claim(activity.id, entry.accountId)}>
            {claimed ? "Claimed" : entry.status === "claiming" ? "Claiming…" : "Claim"}
          </button>
        </li>;
      })}
    </ul>
  </section>;
}
