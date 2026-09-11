import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

type Theme = "classic" | "dark" | "light";
type IconName = "gauge" | "refresh" | "settings" | "close" | "chevron";
const themes: { id: Theme; name: string; description: string }[] = [
  { id: "classic", name: "Original", description: "原稿深色 · 清晰边框" },
  { id: "dark", name: "Midnight", description: "精致深色 · 柔和层次" },
  { id: "light", name: "Pearl", description: "精致浅色 · 干净通透" },
];

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    gauge: <><path d="M4.9 19a9 9 0 1 1 14.2 0" /><path d="m12 13 4-5" /><circle cx="12" cy="13" r="1" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" /></>,
    settings: <><path d="m9.5 3-.7 2.4-2 .9-2.4-.6-2 3.5 1.7 1.8v2L2.4 15l2 3.5 2.4-.6 2 .9.7 2.2h5l.7-2.2 2-.9 2.4.6 2-3.5-1.7-2v-2l1.7-1.8-2-3.5-2.4.6-2-.9L14.5 3z" /><circle cx="12" cy="12" r="3" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    chevron: <path d="m9 5 7 7-7 7" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const accounts = [
  { id: "codex", provider: "OpenAI Codex", mark: "O", email: "user@example.com", limits: [
    { label: "5 Hour Limit", remaining: 85, reset: "Resets at 17:08", time: "2h 37m" },
    { label: "Weekly Limit", remaining: 83, reset: "Resets Sep 15", time: "4d 8h" },
  ] },
  { id: "claude", provider: "Claude", mark: "C", email: "personal@sample.dev", limits: [
    { label: "5 Hour Limit", remaining: 64, reset: "Resets at 16:42", time: "2h 11m" },
    { label: "Weekly Limit", remaining: 71, reset: "Resets Sep 16", time: "5d 9h" },
  ] },
] as const;

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("quotapeek-theme");
    return saved === "classic" || saved === "light" ? saved : "dark";
  } catch { return "dark"; }
}

function App() {
  const [page, setPage] = useState(0);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("quotapeek-theme", theme); } catch { /* Storage can be unavailable in private sessions. */ }
  }, [theme]);

  useEffect(() => { if (settingsOpen) closeButton.current?.focus(); }, [settingsOpen]);

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

        {settingsOpen && <section id="appearance-settings" className="settings-panel" aria-labelledby="settings-title" onKeyDown={event => { if (event.key === "Escape") closeSettings(); }}>
          <div className="settings-heading"><h2 id="settings-title">Appearance</h2><button ref={closeButton} className="icon-button" aria-label="Close settings" onClick={closeSettings}><Icon name="close" /></button></div>
          <fieldset className="theme-options"><legend className="sr-only">Color theme</legend>{themes.map(option => <label key={option.id} title={option.description}>
            <input type="radio" name="theme" value={option.id} checked={theme === option.id} onChange={() => setTheme(option.id)} />
            <span className="theme-option"><span className={`theme-swatch swatch-${option.id}`} aria-hidden="true"><span /></span><span>{option.name}</span></span>
          </label>)}</fieldset>
        </section>}

        <div className="carousel" aria-label="AI accounts" onKeyDown={navigate}>
          <div className="carousel-viewport" onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            drag.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerUp={finishSwipe} onPointerCancel={() => { drag.current = null; }}>
            <div className={`carousel-track page-${page}`}>
              {accounts.map((account, index) => <article key={account.id} id={`panel-${account.id}`} role="tabpanel" aria-labelledby={`tab-${account.id}`} aria-hidden={page !== index} inert={page !== index} tabIndex={page === index ? 0 : -1} className={`account-card provider-${account.id}`}>
                <div className="account-header">
                  <span className="provider-mark" aria-hidden="true">{account.mark}</span>
                  <div className="account-identity"><h2>{account.provider}</h2><p title={account.email}>{account.email}</p></div>
                  <span className="connection-status" role="img" aria-label="Connected (demo)" title="Connected (demo)" />
                </div>
                <div className="limits">{account.limits.map(limit => <section className="limit" key={limit.label} aria-label={limit.label}>
                  <div className="limit-summary"><h3>{limit.label}</h3><div className="quota-value"><strong>{limit.remaining}<span>%</span></strong><span className="remaining-label">remaining</span></div></div>
                  <progress max={100} value={limit.remaining} aria-label={`${account.provider} ${limit.label} remaining`}>{limit.remaining}%</progress>
                  <div className="reset-details"><span>{limit.reset}</span><span>{limit.time} left</span></div>
                </section>)}</div>
              </article>)}
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
