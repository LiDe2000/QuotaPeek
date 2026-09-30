import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AddAccount from "./components/AddAccount";
import { useAccounts } from "./hooks/useAccounts";
import { accountLabel } from "./types/quota";
import AccountCard from "./components/AccountCard";
import AppearanceSettings from "./components/AppearanceSettings";
import { useAppearance } from "./hooks/useAppearance";
import { useFittedWindowHeight } from "./hooks/useFittedWindowHeight";
import Icon from "./components/Icon";
import "./App.css";

function App() {
  const desktop = isTauri();
  const { accounts, loading, error, notice, refreshCodex, refreshWorkbuddy } = useAccounts();
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const accountButton = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(0);
  const { theme, setTheme } = useAppearance();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const body = useRef<HTMLDivElement>(null);

  // The desktop window follows its card; the browser preview keeps its viewport.
  useFittedWindowHeight(body, desktop);

  function closeAccountPanel() {
    setAccountPanelOpen(false);
    accountButton.current?.focus();
  }

  async function connectCodex(): Promise<boolean> {
    const connected = await refreshCodex();
    if (connected) {
      setPage(0);
      closeAccountPanel();
    }
    return connected;
  }

  async function connectWorkbuddy(): Promise<boolean> {
    const connected = await refreshWorkbuddy();
    if (connected) {
      setPage(0);
      closeAccountPanel();
    }
    return connected;
  }

  // Refresh connected providers one at a time; each call paces its own requests.
  async function refreshAll() {
    if (accounts.some(account => account.providerId === "codex")) await refreshCodex();
    if (accounts.some(account => account.providerId === "workbuddy")) await refreshWorkbuddy();
  }

  function closeSettings() {
    setSettingsOpen(false);
    settingsButton.current?.focus();
  }

  // Panels are overlays, so a press anywhere but the panel or the toolbar dismisses them.
  const panelOpen = accountPanelOpen || settingsOpen;
  useEffect(() => {
    if (!panelOpen) return;
    function dismiss(event: Event) {
      if ((event.target as Element | null)?.closest(".panel, .icon-button")) return;
      setAccountPanelOpen(false);
      setSettingsOpen(false);
    }
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [panelOpen]);

  function navigate(event: KeyboardEvent<HTMLElement>) {
    if (!accounts.length) return;
    let next = page;
    if (event.key === "ArrowRight") next = (page + 1) % accounts.length;
    else if (event.key === "ArrowLeft") next = (page + accounts.length - 1) % accounts.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = accounts.length - 1;
    else return;
    event.preventDefault();
    setPage(next);
    tabs.current[next]?.focus();
  }

  function finishSwipe(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      setPage(current => Math.max(0, Math.min(accounts.length - 1, current + (dx < 0 ? 1 : -1))));
    }
  }

  return (
    <main className="app-shell">
      <section className="quota-window" aria-label="QuotaPeek AI usage">
        <header className="window-header">
          <div className="brand" onMouseDown={event => { if (desktop && event.button === 0) void getCurrentWindow().startDragging(); }}><img className="app-icon" src={`${import.meta.env.BASE_URL}quotapeek.svg`} alt="" draggable={false} /><h1>QuotaPeek</h1></div>
          <div className="window-actions">
            <button className="icon-button refresh-button" aria-label="Refresh quota" title="Refresh quota" disabled={accounts.length === 0 || loading} onClick={() => void refreshAll()}>
              <span className={loading ? "refresh-icon is-refreshing" : "refresh-icon"}><Icon name="refresh" /></span>
            </button>
            <button ref={accountButton} className="icon-button" aria-label="Add account" title="Add account" aria-expanded={accountPanelOpen} aria-controls="add-account" onClick={() => { if (accountPanelOpen) closeAccountPanel(); else { setSettingsOpen(false); setAccountPanelOpen(true); } }}><Icon name="user" /></button>
            <button ref={settingsButton} className="icon-button" aria-label="Appearance settings" aria-expanded={settingsOpen} aria-controls="appearance-settings" title="Appearance" onClick={() => { if (settingsOpen) closeSettings(); else { setAccountPanelOpen(false); setSettingsOpen(true); } }}><Icon name="settings" /></button>
            {desktop && <div className="desktop-window-actions">
              <button className="window-control" aria-label="Minimize window" title="Minimize" onClick={() => void getCurrentWindow().minimize()}><Icon name="minimize" /></button>
              <button className="window-control" aria-label="Close window" title="Close" onClick={() => void getCurrentWindow().close()}><Icon name="close" /></button>
            </div>}
          </div>
        </header>

        {accountPanelOpen && <AddAccount codexConnected={accounts.some(account => account.providerId === "codex")} workbuddyConnected={accounts.some(account => account.providerId === "workbuddy")} loading={loading} error={error} onConnectCodex={connectCodex} onConnectWorkbuddy={connectWorkbuddy} onClose={closeAccountPanel} />}
        {settingsOpen && <AppearanceSettings theme={theme} onThemeChange={setTheme} onClose={closeSettings} />}

        <div className="window-body" ref={body} role="region" aria-label="AI account quota details" tabIndex={0}>
          {accounts.length > 0 && <div className="carousel" aria-label="AI accounts" onKeyDown={navigate}>
            <div className="carousel-viewport" onPointerDown={event => {
              if (!event.isPrimary || event.button !== 0) return;
              // Controls inside a card must keep their clicks; capturing the pointer
              // would retarget the browser's click event to the viewport.
              if ((event.target as Element | null)?.closest("button, a, input, select, textarea")) return;
              drag.current = { x: event.clientX, y: event.clientY };
              event.currentTarget.setPointerCapture(event.pointerId);
            }} onPointerUp={finishSwipe} onPointerCancel={() => { drag.current = null; }}>
              <div className="carousel-track" style={{ transform: `translateX(-${page * 100}%)` }}>
                {accounts.map((account, index) => <AccountCard key={account.id} account={account} active={page === index} stale={!!error} loading={loading} />)}              </div>
            </div>
            <nav className="pagination" aria-label="Account pages">
              <button className="page-arrow previous" aria-label="Previous account" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="chevron" /></button>
              <div className="page-dots" role="tablist" aria-label="Select account">{accounts.map((account, index) => <button ref={node => { tabs.current[index] = node; }} key={account.id} id={`tab-${account.id}`} role="tab" aria-label={`${account.providerId} · ${accountLabel(account) ?? "Local account"}`} aria-selected={page === index} aria-controls={`panel-${account.id}`} tabIndex={page === index ? 0 : -1} className={`page-dot${page === index ? " is-active" : ""}`} onClick={() => setPage(index)}><span /></button>)}</div>
              <button className="page-arrow" aria-label="Next account" disabled={page === accounts.length - 1} onClick={() => setPage(page + 1)}><Icon name="chevron" /></button>
            </nav>
          </div>}
        </div>

        <footer className="window-footer"><span role="status" aria-live="polite">{loading ? "Reading quota…" : error ?? notice ?? (accounts[0] ? `Updated ${new Date(accounts[0].fetchedAt * 1000).toLocaleTimeString()}` : "No accounts · Use the user icon to connect one")}</span></footer>
      </section>
    </main>
  );
}

export default App;
