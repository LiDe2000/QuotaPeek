export type ActivityStatus = "unknown" | "available" | "claiming" | "claimed" | "verification" | "failed" | "pending";
export interface ActivityEntry { accountId: string; status: ActivityStatus; note?: string }
export interface Activity {
  id: string;
  providerId: "workbuddy" | "zcode";
  title: string;
  reward: string;
  description?: string;
  entries: ActivityEntry[];
}
export function claimableEntries(activities: readonly Activity[]): { activityId: string; accountId: string }[] {
  return activities.flatMap(activity =>
    activity.entries.filter(entry => entry.status === "available").map(entry => ({ activityId: activity.id, accountId: entry.accountId })));
}
export function updateActivityEntry(activities: readonly Activity[], id: string, accountId: string, status: ActivityStatus, note?: string): Activity[] {
  return activities.map(activity => activity.id !== id ? activity : { ...activity,
    entries: activity.entries.map(entry => entry.accountId !== accountId ? entry : { ...entry, status, note }) });
}
