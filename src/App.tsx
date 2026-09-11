import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import AccountCard from "./components/AccountCard";
import AppearanceSettings, { readTheme } from "./components/AppearanceSettings";
import type { Theme } from "./components/AppearanceSettings";
import Icon from "./components/Icon";
import { accounts } from "./mocks/quotas";
import "./App.css";

function App() {
  const [page, setPage] = useState(0);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("quotapeek-theme", theme); } catch { /* Storage can be unavailable in private sessions. */ }
  }, [theme]);

  function closeSettings() {
    setSettingsOpen(false);
    settingsButton.current?.focus();
  }

  function navigate(event: KeyboardEvent<HTMLElement>) {
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
          <div className="brand"><span className="app-icon"><Icon name="gauge" /></span><h1>QuotaPeek</h1></div>
          <div className="window-actions">
            <button className="icon-button" aria-label="Reload demo data" title="Reload demo data" onClick={() => setRefreshCount(count => count + 1)}>
              <span key={refreshCount} className={refreshCount ? "refresh-icon is-refreshing" : "refresh-icon"}><Icon name="refresh" /></span>
            </button>
            <button ref={settingsButton} className="icon-button" aria-label="Appearance settings" aria-expanded={settingsOpen} aria-controls="appearance-settings" title="Appearance" onClick={() => settingsOpen ? closeSettings() : setSettingsOpen(true)}><Icon name="settings" /></button>
          </div>
        </header>

        {settingsOpen && <AppearanceSettings theme={theme} onThemeChange={setTheme} onClose={closeSettings} />}

        <div className="carousel" aria-label="AI accounts" onKeyDown={navigate}>
          <div className="carousel-viewport" onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            drag.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerUp={finishSwipe} onPointerCancel={() => { drag.current = null; }}>
            <div className="carousel-track" style={{ transform: `translateX(-${page * 100}%)` }}>
              {accounts.map((account, index) => <AccountCard key={account.id} account={account} active={page === index} />)}
            </div>
          </div>
          <nav className="pagination" aria-label="Account pages">
            <button className="page-arrow previous" aria-label="Previous account" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="chevron" /></button>
            <div className="page-dots" role="tablist" aria-label="Select account">{accounts.map((account, index) => <button ref={node => { tabs.current[index] = node; }} key={account.id} id={`tab-${account.id}`} role="tab" aria-label={account.provider} aria-selected={page === index} aria-controls={`panel-${account.id}`} tabIndex={page === index ? 0 : -1} className={`page-dot${page === index ? " is-active" : ""}`} onClick={() => setPage(index)}><span /></button>)}</div>
            <button className="page-arrow" aria-label="Next account" disabled={page === accounts.length - 1} onClick={() => setPage(page + 1)}><Icon name="chevron" /></button>
          </nav>
        </div>

        <footer className="window-footer"><span className="demo-label">Demo</span><span role="status" aria-live="polite">{refreshCount ? `Sample data reloaded · ${refreshCount}` : "Sample data · No accounts connected"}</span></footer>
      </section>
    </main>
  );
}

export default App;
