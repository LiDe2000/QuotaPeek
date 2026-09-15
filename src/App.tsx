import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AddAccount from "./components/AddAccount";
import { useAccounts } from "./hooks/useAccounts";
import AccountCard from "./components/AccountCard";
import AppearanceSettings from "./components/AppearanceSettings";
import { useAppearance } from "./hooks/useAppearance";
import Icon from "./components/Icon";
import "./App.css";

function App() {
  const desktop = isTauri();
  const { accounts, loading, error, notice, refreshCodex } = useAccounts();
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const accountButton = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(0);
  const { theme, setTheme } = useAppearance();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef<{ x: number; y: number } | null>(null);

  function closeAccountPanel() {
    setAccountPanelOpen(false);
    accountButton.current?.focus();
  }

  async function connectCodex() {
    if (await refreshCodex()) {
      setPage(0);
      closeAccountPanel();
    }
  }

  function closeSettings() {
    setSettingsOpen(false);
    settingsButton.current?.focus();
  }

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
            <button className="icon-button refresh-button" aria-label="Refresh Codex quota" title="Refresh Codex quota" disabled={accounts.length === 0 || loading} onClick={() => void refreshCodex()}>
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

        {accountPanelOpen && <AddAccount connected={accounts.length > 0} loading={loading} error={error} onConnect={connectCodex} onClose={closeAccountPanel} />}
        {settingsOpen && <AppearanceSettings theme={theme} onThemeChange={setTheme} onClose={closeSettings} />}

        {accounts.length > 0 && <div className="carousel" aria-label="AI accounts" onKeyDown={navigate}>
          <div className="carousel-viewport" onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            drag.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerUp={finishSwipe} onPointerCancel={() => { drag.current = null; }}>
            <div className="carousel-track" style={{ transform: `translateX(-${page * 100}%)` }}>
              {accounts.map((account, index) => <AccountCard key={account.id} account={account} active={page === index} stale={!!error} loading={loading} />)}
            </div>
          </div>
          <nav className="pagination" aria-label="Account pages">
            <button className="page-arrow previous" aria-label="Previous account" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="chevron" /></button>
            <div className="page-dots" role="tablist" aria-label="Select account">{accounts.map((account, index) => <button ref={node => { tabs.current[index] = node; }} key={account.id} id={`tab-${account.id}`} role="tab" aria-label={`${account.providerId} · ${account.email ?? "Local account"}`} aria-selected={page === index} aria-controls={`panel-${account.id}`} tabIndex={page === index ? 0 : -1} className={`page-dot${page === index ? " is-active" : ""}`} onClick={() => setPage(index)}><span /></button>)}</div>
            <button className="page-arrow" aria-label="Next account" disabled={page === accounts.length - 1} onClick={() => setPage(page + 1)}><Icon name="chevron" /></button>
          </nav>
        </div>}

        <footer className="window-footer"><span role="status" aria-live="polite">{loading ? "Reading Codex quota…" : error ?? notice ?? (accounts[0] ? `Updated ${new Date(accounts[0].fetchedAt * 1000).toLocaleTimeString()}` : "No accounts · Use the user icon to connect one")}</span></footer>
      </section>
    </main>
  );
}

export default App;
