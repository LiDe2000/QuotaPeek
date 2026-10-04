import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import AddAccount from "./components/accounts/AddAccount";
import { useAccounts } from "./hooks/useAccounts";
import type { Account } from "./types/quota";
import { accountLabel } from "./types/quota";
import AccountCard from "./components/accounts/AccountCard";
import AppearanceSettings from "./components/settings/AppearanceSettings";
import OrbRail from "./components/navigation/OrbRail";
import ProviderSwitcher from "./components/navigation/ProviderSwitcher";
import { PROVIDER_SELECTION_KEY, PROVIDER_ORDER_KEY, providerGroups, readProviderSelection, readProviderOrder, moveProvider } from "./lib/providers/providerGroups";
import type { ProviderSelection, Provider } from "./lib/providers/providerGroups";
import { useHoverPreview } from "./hooks/useHoverPreview";
import { useAppearance } from "./hooks/useAppearance";
import { useFittedWindowHeight } from "./hooks/useFittedWindowHeight";
import Icon from "./components/shared/Icon";
import { formatRefreshTime } from "./lib/format/refreshTime";
import { storage, saveSettings } from "./services/storage";
import { useStorageStatus } from "./hooks/useStorageStatus";
import { useActivities } from "./hooks/useActivities";
import ActivityPanel from "./components/activities/ActivityPanel";
import { activityPreviewAccounts } from "./lib/activities/preview";
import { claimableEntries } from "./lib/activities/activityState";
import "./App.css";

type Popup = null | "home" | "add" | "appearance" | "activities";
function readSelected(): string | null {
  return storage.getSetting("quotapeek-selected-account");
}

function App() {
  const desktop = isTauri();
  const activityPreview = import.meta.env.DEV && (import.meta.env.VITE_ACTIVITY_PREVIEW === "1" || new URLSearchParams(window.location.search).get("preview") === "activities");
  const { accounts: connectedAccounts, statuses, summary, restoring, startupErrors, manualRefresh, refreshAccount, refreshAll, connect, removeAccount } = useAccounts();
  const accounts = activityPreview ? activityPreviewAccounts : connectedAccounts;
  const [selectedId, setSelectedId] = useState<string | null>(readSelected);
  const [providerSelection, setProviderSelection] = useState<ProviderSelection>(() => {
    return readProviderSelection(storage.getSetting(PROVIDER_SELECTION_KEY));
  });
  const { theme, setTheme } = useAppearance();
  const [providerOrder, setProviderOrder] = useState(() => readProviderOrder(storage.getSetting(PROVIDER_ORDER_KEY)));
  const storageError = useStorageStatus();
  const [popup, setPopup] = useState<Popup>(activityPreview ? "activities" : null);
  const activities = useActivities(accounts, activityPreview, popup === "activities", refreshAccount);
  const readyRewards = claimableEntries(activities.activities).length;
  const preview = useHoverPreview();
  const drag = useRef<{ x: number; y: number } | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const currentAccount = accounts.find(account => account.id === selectedId) ?? accounts[0];
  const groups = providerGroups(accounts, providerSelection, providerOrder);
  function reorderProviders(source: Provider, target: Provider) {
    const next = moveProvider(groups.map(group => group.providerId), source, target);
    setProviderOrder(next);
    if (!activityPreview) saveSettings({ [PROVIDER_ORDER_KEY]: JSON.stringify(next) });
  }
  const currentGroup = groups.find(group => group.providerId === currentAccount?.providerId);
  const groupAccounts = currentGroup?.accounts ?? [];
  const page = currentAccount ? groupAccounts.findIndex(account => account.id === currentAccount.id) : 0;
  const hoveredGroup = groups.find(group => group.providerId === preview.accountId);
  const hoveredAccount = hoveredGroup?.selected;
  function selectAccount(id: string) {
    const account = accounts.find(candidate => candidate.id === id);
    if (!account) return;
    setSelectedId(id);
    setProviderSelection(previous => ({ ...previous, [account.providerId]: id }));
  }
  const loading = Object.values(statuses).some(status => status.loading);
  const settingsOpen = popup === "appearance";
  useFittedWindowHeight(body, desktop,
    import.meta.env.DEV && import.meta.env.VITE_QUOTAPEEK_FIXED_VIEWPORT === "1",
    !(import.meta.env.DEV && import.meta.env.VITE_QUOTAPEEK_STABLE_VIEWPORT === "0"));

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("desktop-show-main", () => setPopup("home")).then(stop => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(error => console.warn("Tray listener was refused", error));
    return () => { disposed = true; unlisten?.(); };
  }, [desktop]);

  useEffect(() => {
    if (currentAccount) {
      if (selectedId !== currentAccount.id) setSelectedId(currentAccount.id);
      setProviderSelection(previous => previous[currentAccount.providerId] === currentAccount.id ? previous
        : { ...previous, [currentAccount.providerId]: currentAccount.id });
    }
  }, [currentAccount, selectedId]);
  useEffect(() => {
    if (activityPreview) return;
    const patch: Record<string, string> = { [PROVIDER_SELECTION_KEY]: JSON.stringify(providerSelection) };
    patch["quotapeek-selected-account"] = selectedId ?? "";
    saveSettings(patch);
  }, [selectedId, providerSelection, activityPreview]);

  useEffect(() => {
    if (popup !== "activities") return;
    function closeActivities(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") { setPopup("home"); requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(".activities-trigger")?.focus()); }
    }
    window.addEventListener("keydown", closeActivities);
    return () => window.removeEventListener("keydown", closeActivities);
  }, [popup]);

  useEffect(() => {
    if (popup && panel.current) panel.current.scrollTop = 0;
  }, [currentAccount?.id, popup]);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const card = popup ? panel.current?.querySelector(".carousel-page:not([hidden]) .account-card")
      : body.current?.querySelector(".orb-float .account-card");
    // Animate only the inner content; the card surface stays opaque and stationary.
    const animations = Array.from(card?.children ?? []).map(child => child.animate([
      { opacity: 0.94, transform: "translateY(3px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 160, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }));
    return () => animations.forEach(animation => animation.cancel());
  }, [currentAccount?.id, hoveredAccount?.id, popup]);

  async function connectAccount(provider: Account["providerId"], accountId?: string): Promise<boolean> {
    const account = await connect(provider, accountId, id => {
      setSelectedId(id);
      setProviderSelection(previous => ({ ...previous, [provider]: id }));
    });
    if (account) {
      setSelectedId(account.id);
      setProviderSelection(previous => ({ ...previous, [provider]: account.id }));
      // Finishing a hidden login updates its account without reopening the window.
      setPopup(open => open === "add" ? "home" : open);
    }
    return account !== null;
  }

  async function removeCurrentAccount(id: string): Promise<boolean> {
    if (!await removeAccount(id)) return false;
    preview.hide();
    setSelectedId(storage.getSetting("quotapeek-selected-account") || null);
    setProviderSelection(readProviderSelection(storage.getSetting(PROVIDER_SELECTION_KEY)));
    requestAnimationFrame(() => {
      const target = panel.current?.querySelector<HTMLElement>(".carousel-page:not([hidden]) .account-remove-trigger")
        ?? panel.current?.querySelector<HTMLElement>('[aria-controls="add-account"]');
      target?.focus();
    });
    return true;
  }

  function shellDrag(event: React.MouseEvent) {
    if (!desktop || event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest("button, a, input, select, textarea, summary, .orb-pop, .orb-float")) return;
    void getCurrentWindow().startDragging();
  }

  useEffect(() => {
    if (!settingsOpen) return;
    function dismiss(event: Event) {
      if ((event.target as Element | null)?.closest(".panel, .icon-button")) return;
      setPopup(open => open === "appearance" ? "home" : open);
    }
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [settingsOpen]);

  function select(index: number) {
    const account = groupAccounts[index];
    if (account) selectAccount(account.id);
  }
  function finishSwipe(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      select(Math.max(0, Math.min(groupAccounts.length - 1, page + (dx < 0 ? 1 : -1))));
    }
  }
  function navigate(event: KeyboardEvent<HTMLElement>) {
    if (!groupAccounts.length || (event.target as Element).closest("button, input, select, textarea, summary")) return;
    let next = page;
    if (event.key === "ArrowRight") next = (page + 1) % groupAccounts.length;
    else if (event.key === "ArrowLeft") next = (page + groupAccounts.length - 1) % groupAccounts.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = groupAccounts.length - 1;
    else return;
    event.preventDefault();
    select(next);
  }

  function accountPicker(members: readonly Account[], id: string, label: string, compact = false) {
    if (members.length < 2) return null;
    const index = members.findIndex(account => account.id === id);
    const account = members[index];
    if (compact) return <div className={`preview-account-switcher provider-${account.providerId}`} role="group" aria-label={label}>
      {members.map((member, position) => <button type="button" key={member.id} className="preview-account-number"
        aria-label={`Switch to account ${position + 1}: ${accountLabel(member) || member.id}`}
        aria-pressed={member.id === id} title={accountLabel(member) || member.id} onClick={() => selectAccount(member.id)}>
        {position + 1}
      </button>)}
    </div>;
    return <div className={`account-switcher provider-${account.providerId}`} role="group" aria-label={label}>
      <div className="account-choices">
        {members.map((member, position) => {
          const name = accountLabel(member) || `Account ${position + 1}`;
          const region = member.providerId === "deepseek" ? (member.source === "deepseek-api" ? "API" : null) : member.providerId === "codex" ? null : member.region === "cn" ? "CN" : "Global";
          return <button type="button" key={member.id} className="account-choice" aria-pressed={member.id === id}
            aria-label={`Switch to ${name}${region ? ` · ${region}` : ""}`} title={`${name}${region ? ` · ${region}` : ""}`}
            onClick={() => selectAccount(member.id)}>
            <span className="account-choice-name">{name}</span>
            {region && <span className="account-choice-region">{region}</span>}
          </button>;
        })}
      </div>
    </div>;
  }

  function renderCard(account: Account, previewCard = false) {
    const status = statuses[account.id];
    return <AccountCard account={account} active stale={!!status?.error} loading={!!status?.loading} preview={previewCard}
      removalDisabled={restoring} onRemove={activityPreview ? undefined : () => removeCurrentAccount(account.id)} />;
  }
  const currentStatus = currentAccount ? statuses[currentAccount.id] : undefined;
  const fetchedAt = currentStatus?.lastSuccess ?? currentAccount?.fetchedAt;
  const footer = storageError ?? (currentStatus?.removing ? "Removing this account…" : currentStatus?.loading ? "Reading this account's quota…"
    : currentStatus?.error ?? currentStatus?.notice ?? (fetchedAt ? `Updated ${formatRefreshTime(fetchedAt)}`
      : currentAccount ? "Quota not yet available" : restoring ? "Restoring accounts…" : ""));

  return (
    <main className="app-shell" onMouseDown={shellDrag}>
      <section className="quota-window" aria-label="QuotaPeek AI usage">
        <div className="window-body" ref={body} role="region" aria-label="AI account quota details" tabIndex={0} onMouseLeave={preview.leave}>
          <OrbRail groups={groups} selectedProvider={currentAccount?.providerId} cardOpen={popup !== null} refreshingIds={Object.keys(statuses).filter(id => statuses[id].loading)}
            onReorder={reorderProviders} onReorderPress={preview.hide}
            onToggleHome={() => { preview.hide(); setPopup(open => open ? null : "home"); }}
            onHover={provider => { if (!popup) preview.enter(provider); }}
            onLeave={preview.leave}
            onRefresh={id => { const account = accounts.find(account => account.id === id); if (account && !activityPreview) void manualRefresh(account.providerId, id); else if (account) { selectAccount(id); setPopup("home"); } }}
            onAddAccount={() => { preview.hide(); setPopup("add"); }} />
          {hoveredAccount && !popup && <div className="orb-float" aria-label={`${accountLabel(hoveredAccount) ?? hoveredAccount.providerId} quota preview`}
            onMouseEnter={preview.keep} onMouseLeave={preview.leave} onFocus={preview.keep} onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)
                && !(event.relatedTarget as Element | null)?.closest(".orb-ring[data-provider]")) preview.leave();
            }} style={{ "--orb-i": groups.findIndex(group => group.providerId === hoveredAccount.providerId) } as CSSProperties}>
            {renderCard(hoveredAccount, true)}
            <div className="orb-preview-status">
              <div className="orb-preview-messages" role="status" aria-live="polite">
              {statuses[hoveredAccount.id]?.loading && <span>Refreshing this account…</span>}
              {statuses[hoveredAccount.id]?.notice && <span>{statuses[hoveredAccount.id].notice}</span>}
              {statuses[hoveredAccount.id]?.error && <span className="orb-preview-error">Refresh failed · {statuses[hoveredAccount.id].error}</span>}
              </div>
              <div className="orb-preview-footer">
              <span className="orb-preview-updated">{(statuses[hoveredAccount.id]?.lastSuccess ?? hoveredAccount.fetchedAt)
                ? `Last updated ${formatRefreshTime(statuses[hoveredAccount.id]?.lastSuccess ?? hoveredAccount.fetchedAt, true)}` : "Quota not yet available"}</span>
              {accountPicker(hoveredGroup!.accounts, hoveredAccount.id, "Preview account", true)}
              </div>
            </div>
          </div>}
          {/* Stay mounted when hidden: hiding the window or panel keeps login waiting. */}
          <section className="orb-pop" data-compact={!currentAccount && popup === "home"} ref={panel} aria-label="QuotaPeek accounts" hidden={!popup}>
            <header className="window-header">
              <div className="brand" onMouseDown={event => { if (desktop && event.button === 0) void getCurrentWindow().startDragging(); }}><img className="app-icon" src={`${import.meta.env.BASE_URL}quotapeek.svg`} alt="" draggable={false} /><h1>QuotaPeek</h1></div>
              <div className="window-actions">
                <button className="icon-button refresh-button" aria-label={popup === "activities" ? "Refresh activities" : "Refresh quota"} title={popup === "activities" ? "Refresh activities and claim status" : "Refresh all accounts"}
                  disabled={popup === "activities" ? activities.refreshing || activities.batchRunning || activities.claimRunning : activityPreview || accounts.length === 0 || loading || restoring}
                  onClick={() => void (popup === "activities" ? activities.refresh() : refreshAll())}>
                  <span className={(popup === "activities" ? activities.refreshing : loading) ? "refresh-icon is-refreshing" : "refresh-icon"}><Icon name="refresh" /></span>
                </button>
                <button className="icon-button" aria-label="Add account" disabled={activityPreview} aria-expanded={popup === "add"} aria-controls="add-account" title="Accounts" onClick={() => setPopup(open => open === "add" ? "home" : "add")}><Icon name="account-login" /></button>
                <button className="icon-button" aria-label="Appearance settings" aria-expanded={settingsOpen} title="Appearance" onClick={() => setPopup(open => open === "appearance" ? "home" : "appearance")}><Icon name="theme" /></button>
                <button type="button" className="icon-button activities-trigger" aria-label={`Activities${readyRewards ? ` · ${readyRewards} rewards ready to claim` : ""}`} aria-expanded={popup === "activities"} aria-controls="activities-panel" title="Activities" onClick={() => { preview.hide(); setPopup(open => open === "activities" ? "home" : "activities"); }}>
                  <Icon name="gift" />
                  {readyRewards > 0 && <span className="activities-trigger-count" aria-hidden="true">{readyRewards}</span>}
                </button>
              </div>
            </header>
            {popup === "activities" && <ActivityPanel accounts={accounts} controller={activities}
              onClose={() => { setPopup("home"); requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(".activities-trigger")?.focus()); }} />}
            {activityPreview && popup === "home" && <p className="activity-preview-notice">Interactive preview · Sample accounts and rewards.</p>}
            {settingsOpen && <AppearanceSettings theme={theme} onThemeChange={setTheme} onClose={() => setPopup("home")} />}
            <AddAccount hidden={popup !== "add"} codexConnected={accounts.some(account => account.providerId === "codex")}
              onConnectCodex={() => connectAccount("codex")}
              onConnectWorkbuddy={id => connectAccount("workbuddy", id)} onConnectZcode={id => connectAccount("zcode", id)}
              onConnectDeepseek={id => connectAccount("deepseek", id)}
              onClose={() => setPopup("home")} />
            {popup !== "activities" && groups.length > 1 && <ProviderSwitcher groups={groups} selected={currentAccount?.providerId} onSelect={selectAccount} onReorder={reorderProviders} />}
            {popup !== "activities" && currentAccount && accountPicker(groupAccounts, currentAccount.id, "Select account")}
            {popup !== "activities" && accounts.length > 0 && <div className="carousel" aria-label="AI accounts" onKeyDown={navigate}>
              <div className="carousel-viewport" onPointerDown={event => {
                if (!event.isPrimary || event.button !== 0 || (event.target as Element | null)?.closest("button, a, input, select, textarea, summary")) return;
                drag.current = { x: event.clientX, y: event.clientY };
                event.currentTarget.setPointerCapture(event.pointerId);
              }} onPointerUp={finishSwipe} onPointerCancel={() => { drag.current = null; }}>
                {groupAccounts.map(account => <div className="carousel-page" key={account.id} hidden={account.id !== currentAccount?.id}>
                  {renderCard(account)}
                </div>)}
              </div>
            </div>}
            <footer className="window-footer" hidden={popup === "activities" || activityPreview || (!footer && !summary && startupErrors.length === 0)}><span role="status" aria-live="polite">{footer}</span>
              {currentStatus?.error && !!fetchedAt && <span>Last successful query {formatRefreshTime(fetchedAt)}</span>}
              {summary && <span role="status">{summary}</span>}
              {startupErrors.map(message => <span key={message}>{message}</span>)}
            </footer>
          </section>
        </div>
      </section>
    </main>
  );
}
export default App;
