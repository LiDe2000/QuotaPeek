import { useCallback, useEffect, useRef, useState } from "react";
import type { Account } from "../types/quota";
import type { Activity } from "../lib/activities/activityState";
import type { ActivityCatalog } from "../lib/activities/catalog";
import { claimableEntries, updateActivityEntry } from "../lib/activities/activityState";
import { catalogActivities, isMock } from "../lib/activities/catalog";
import { loadActivities, requestActivity } from "../lib/activities/runtimeClient";
import { storage } from "../services/storage";

export function useActivities(accounts: readonly Account[], demo: boolean, visible: boolean, onClaimed?: (accountId: string) => Promise<unknown>) {
  const source = storage.getSetting("quotapeek-activity-service-url")
    || import.meta.env.VITE_ACTIVITY_SERVICE_URL
    || (import.meta.env.DEV ? "http://127.0.0.1:1431/v1/activities" : "");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [claimRunning, setClaimRunning] = useState(false);
  const [configSource, setConfigSource] = useState<"server" | "local" | null>(null);
  const session = useRef("");
  const latest = useRef(activities);
  const members = useRef(accounts);
  members.current = accounts;
  const refreshAccount = useRef(onClaimed);
  refreshAccount.current = onClaimed;
  const refreshedClaims = useRef(new Set<string>());
  const catalog = useRef<ActivityCatalog | null>(null);
  const request = useRef<AbortController | null>(null);
  const busy = useRef(new Set<string>());
  const batch = useRef(false);
  const alive = useRef(true);
  const pendingRefresh = useRef(false);
  const visibleNow = useRef(visible);
  visibleNow.current = visible;
  const refreshCurrent = useRef<() => Promise<void>>(async () => {});
  const signature = JSON.stringify(accounts.map(account => [account.id, account.providerId, "region" in account ? account.region : null]));

  const publish = useCallback((next: Activity[]) => {
    latest.current = next;
    if (alive.current) setActivities(next);
  }, []);
  const refreshClaimedAccount = useCallback(async (activityId: string, accountId: string) => {
    const key = `${activityId}:${accountId}`;
    if (demo || !alive.current || refreshedClaims.current.has(key)) return;
    refreshedClaims.current.add(key);
    // Quota refresh failure must not erase a confirmed claim receipt.
    try { await refreshAccount.current?.(accountId); } catch { /* Account UI reports its refresh error. */ }
  }, [demo]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current?.abort(); };
  }, []);

  const refresh = useCallback(async () => {
    if (busy.current.size || batch.current) { pendingRefresh.current = true; return; }
    pendingRefresh.current = false;
    request.current?.abort();
    const run = new AbortController();
    request.current = run;
    setRefreshing(true);
    setMessage(null);
    // Never leave stale 'available' entries actionable during synchronization.
    publish(latest.current.map(activity => ({ ...activity, entries: activity.entries.map(entry => ({ accountId: entry.accountId, status: "unknown" as const })) })));
    try {
      const result = await loadActivities(source, demo, run.signal);
      if (run.signal.aborted || !alive.current) return;
      catalog.current = result.catalog;
      session.current = result.session ?? "";
      setConfigSource(result.source);
      publish(result.catalog ? catalogActivities(result.catalog, members.current, demo) : []);
      setMessage(result.notice);
      if (!result.catalog) return;
      const targets = latest.current.flatMap(activity => activity.entries.map(entry => ({ activityId: activity.id, accountId: entry.accountId })));
      // A small worker pool avoids a burst when there are many logged-in accounts.
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
        while (index < targets.length && !run.signal.aborted) {
          const target = targets[index++];
          const definition = result.catalog!.activities.find(item => item.id === target.activityId)!;
          if (isMock(definition) !== demo) continue;
          try {
            const state = await requestActivity(session.current, definition, target.accountId, false, demo, run.signal);
            if (!run.signal.aborted && alive.current) publish(updateActivityEntry(latest.current, target.activityId, target.accountId,
              !definition.claim && state.status === "available" ? "unknown" : state.status, state.note));
            if (!run.signal.aborted && state.status === "claimed") await refreshClaimedAccount(target.activityId, target.accountId);
            if (state.status === "available") refreshedClaims.current.delete(`${target.activityId}:${target.accountId}`);
          } catch {
            if (!run.signal.aborted && alive.current) publish(updateActivityEntry(latest.current, target.activityId, target.accountId, "unknown", "Could not check claim status. Refresh to retry."));
          }
        }
      }));
    } catch {
      if (!run.signal.aborted && alive.current) {
        catalog.current = null; session.current = "";
        publish([]); setConfigSource(null);
        setMessage("Could not load activity configuration. Refresh to retry.");
      }
    } finally {
      if (request.current === run && alive.current) setRefreshing(false);
    }
  }, [demo, source, publish, refreshClaimedAccount]);
  refreshCurrent.current = refresh;

  function flushPendingRefresh() {
    if (pendingRefresh.current && !busy.current.size && !batch.current && alive.current && visibleNow.current) {
      void refreshCurrent.current();
    }
  }

  useEffect(() => {
    if (visible) void refresh();
    else request.current?.abort();
    return () => { request.current?.abort(); };
  }, [visible, signature, refresh]);

  async function claim(activityId: string, accountId: string) {
    if (refreshing || !claimableEntries(latest.current).some(row => row.activityId === activityId && row.accountId === accountId)) return;
    const definition = catalog.current?.activities.find(item => item.id === activityId);
    if (!definition || !members.current.some(account => account.id === accountId)) return;
    const key = `${activityId}:${accountId}`;
    if (busy.current.has(key)) return;
    busy.current.add(key);
    refreshedClaims.current.delete(key);
    setClaimRunning(true);
    publish(updateActivityEntry(latest.current, activityId, accountId, "claiming"));
    try {
      const state = await requestActivity(session.current, definition, accountId, true, demo);
      if (alive.current) publish(updateActivityEntry(latest.current, activityId, accountId, state.status, state.note));
      if (!demo && state.status === "claimed") {
        await refreshClaimedAccount(activityId, accountId);
      }
      return state.status;
    } catch {
      // A timeout may occur after issuance. Do not retry or assume success.
      if (alive.current) publish(updateActivityEntry(latest.current, activityId, accountId, "pending", "Claim result unconfirmed. Refresh before retrying."));
      return "pending" as const;
    } finally {
      busy.current.delete(key);
      if (alive.current) setClaimRunning(busy.current.size > 0);
      flushPendingRefresh();
    }
  }
  async function claimAll() {
    if (batch.current || busy.current.size || refreshing) return;
    batch.current = true;
    setBatchRunning(true);
    setMessage(null);
    const counts = { claimed: 0, unconfirmed: 0, failed: 0, verification: 0, skipped: 0 };
    try {
      for (const target of claimableEntries(latest.current)) {
        if (!alive.current) break;
        const status = await claim(target.activityId, target.accountId);
        if (status === "claimed") counts.claimed++;
        else if (status === "pending" || status === "unknown" || status === "claiming") counts.unconfirmed++;
        else if (status === "failed") counts.failed++;
        else if (status === "verification") counts.verification++;
        else counts.skipped++;
      }
      if (alive.current) {
        const summary = [
          counts.claimed && `${counts.claimed} claimed`,
          counts.unconfirmed && `${counts.unconfirmed} unconfirmed`,
          counts.failed && `${counts.failed} failed`,
          counts.verification && `${counts.verification} needs verification`,
          counts.skipped && `${counts.skipped} skipped`,
        ].filter(Boolean).join(" · ") || "No rewards available to claim.";
        setMessage(demo ? `Preview · ${summary} · No real rewards were issued.` : summary);
      }
    } finally {
      batch.current = false;
      if (alive.current) setBatchRunning(false);
      flushPendingRefresh();
    }
  }
  return { activities, demo, claim, claimAll, batchRunning, claimRunning, message, refreshing, refresh, configSource };
}
