import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import Icon from "./Icon";
import { workbuddyErrorMessage, pollWorkbuddyLogin, startWorkbuddyLogin } from "../services/workbuddy";
import { pollZcodeLogin, startZcodeLogin, zcodeErrorMessage } from "../services/zcode";
import type { ZcodeSite } from "../services/zcode";
import "./AddAccount.css";
type Platform = "codex" | "workbuddy" | "zcode";
/** Providers that sign in through a browser tab; Codex follows the local CLI login instead. */
type BrowserPlatform = "workbuddy" | "zcode";
interface AddAccountProps {
  codexConnected: boolean;
  workbuddyConnected: boolean;
  zcodeConnected: boolean;
  loading: boolean;
  error: string | null;
  onConnectCodex: () => Promise<boolean>;
  onConnectWorkbuddy: () => Promise<boolean>;
  onConnectZcode: () => Promise<boolean>;
  onClose: () => void;
}
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const BROWSER_COPY: Record<BrowserPlatform, { name: string; mark: string; hint: string }> = {
  workbuddy: {
    name: "WorkBuddy",
    mark: "W",
    hint: "Sign in through the official WorkBuddy page opened in your browser. QuotaPeek receives a token using the same flow as the WorkBuddy CLI and keeps it in the app's local data.",
  },
  zcode: {
    name: "ZCode",
    mark: "Z",
    hint: "Sign in through the official ZCode authorization page opened in your browser. Pick the account system you use — Z.ai (global) or BigModel (智谱, China). QuotaPeek uses the same CLI authorization flow and only reads quota afterwards.",
  },
};
export default function AddAccount({ codexConnected, workbuddyConnected, zcodeConnected, loading, error, onConnectCodex, onConnectWorkbuddy, onConnectZcode, onClose }: AddAccountProps) {
  const [selected, setSelected] = useState<Platform | null>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstButton.current?.focus(); }, [selected]);
  // Browser sign-in: start the flow, hand off to the browser, then poll for the token.
  const [flow, setFlow] = useState<{ provider: BrowserPlatform; state: string } | null>(null);
  const [waitedMs, setWaitedMs] = useState(0);
  const [loginError, setLoginError] = useState<string | null>(null);
  const callbacks = useRef({ onConnectWorkbuddy, onConnectZcode, onClose });
  callbacks.current = { onConnectWorkbuddy, onConnectZcode, onClose };
  const connected = { workbuddy: workbuddyConnected, zcode: zcodeConnected };
  useEffect(() => {
    if (!flow) return;
    const browser = flow.provider;
    let cancelled = false;
    const ticker = window.setInterval(() => setWaitedMs(ms => ms + POLL_INTERVAL_MS), POLL_INTERVAL_MS);
    const poller = window.setInterval(() => {
      void (async () => {
        try {
          const result = browser === "workbuddy" ? await pollWorkbuddyLogin(flow.state) : await pollZcodeLogin(flow.state);
          if (cancelled) return;
          if (result.status === "success") {
            stopWaiting();
            const ok = browser === "workbuddy" ? await callbacks.current.onConnectWorkbuddy() : await callbacks.current.onConnectZcode();
            if (ok) callbacks.current.onClose();
          } else if (result.status === "error") {
            setLoginError(result.message ?? "Sign-in failed. Start again.");
            stopWaiting();
          }
        } catch (failure) {
          if (!cancelled) { setLoginError(browser === "workbuddy" ? workbuddyErrorMessage(failure) : zcodeErrorMessage(failure)); stopWaiting(); }
        }
      })();
    }, POLL_INTERVAL_MS);
    function stopWaiting() {
      cancelled = true;
      window.clearInterval(ticker);
      window.clearInterval(poller);
      setFlow(null);
    }
    return () => { cancelled = true; window.clearInterval(ticker); window.clearInterval(poller); };
  }, [flow]);
  useEffect(() => {
    if (waitedMs >= POLL_TIMEOUT_MS && flow) { setLoginError("Sign-in timed out. Start again and complete it within 10 minutes."); setFlow(null); }
  }, [waitedMs, flow]);
  async function beginBrowserLogin(provider: BrowserPlatform, site?: ZcodeSite) {
    setLoginError(null);
    setWaitedMs(0);
    try {
      const start = provider === "workbuddy" ? await startWorkbuddyLogin() : await startZcodeLogin(site ?? "zai");
      setFlow({ provider, state: start.state });
      await openUrl(start.authUrl);
    } catch (failure) {
      setLoginError(provider === "workbuddy" ? workbuddyErrorMessage(failure) : zcodeErrorMessage(failure));
      setFlow(null);
    }
  }
  const waiting = flow !== null;
  const waitingFor = flow?.provider ?? null;
  const heading = selected ? "STEP 2 OF 2" : "STEP 1 OF 2";
  const browserPanel = (provider: BrowserPlatform) => {
    const copy = BROWSER_COPY[provider];
    // ZCode binds either account system, so the user picks the one they hold.
    const sitePending = provider === "zcode" && !waiting;
    return <>
      <div className={`selected-platform provider-${provider}`}>
        <span className="platform-mark" aria-hidden="true">{copy.mark}</span><strong>{copy.name}</strong>
        <button className="change-platform" disabled={waiting} onClick={() => setSelected(null)}>Change</button>
      </div>
      <p className="account-hint">{copy.hint}</p>
      {waiting
        ? <p className="account-hint" role="status">Waiting for sign-in… {Math.round(waitedMs / 1000)}s elapsed. Finish the login in your browser tab; QuotaPeek picks it up automatically.</p>
        : <p className="account-hint">A browser tab opens for the login. QuotaPeek only reads quota afterwards and never auto-refreshes on a timer.</p>}
      {(loginError || error) && <p className="account-error" role="alert">{loginError ?? error}</p>}
      {waiting && waitingFor === provider
        ? <button ref={firstButton} className="add-account-submit" onClick={() => { setFlow(null); setLoginError("Sign-in cancelled. Start again when ready."); }}>Cancel waiting</button>
        : sitePending
          ? <div className="site-choices">
            <button ref={firstButton} className="add-account-submit" disabled={loading} onClick={() => void beginBrowserLogin(provider, "zai")}>Continue with Z.ai · Global</button>
            <button className="add-account-submit is-secondary" disabled={loading} onClick={() => void beginBrowserLogin(provider, "bigmodel")}>Continue with BigModel · China</button>
          </div>
          : <button ref={firstButton} className="add-account-submit" disabled={loading || waiting} onClick={() => void beginBrowserLogin(provider)}>{connected[provider] ? "Sign in again with browser" : "Sign in with browser"}</button>}
    </>;
  };
  return (
    <section id="add-account" className="panel add-account-panel" aria-labelledby="add-account-title" aria-busy={loading || waiting} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    }}>
      <div className="add-account-heading">
        <div><p className="account-step">{heading}</p><h2 id="add-account-title">Connect account</h2></div>
        <button className="icon-button" aria-label="Close add account" onClick={onClose}><Icon name="close" /></button>
      </div>
      {selected === "codex" ? <>
        <div className="selected-platform provider-codex">
          <span className="platform-mark" aria-hidden="true">O</span><strong>OpenAI Codex</strong>
          <button className="change-platform" disabled={loading} onClick={() => setSelected(null)}>Change</button>
        </div>
        <p className="account-hint">Connect the ChatGPT account currently signed in to Codex on this computer. Your email and quota are read automatically; no password is needed here.</p>
        <p className="account-hint">Sign in to Codex first. This connection follows your local Codex login and supports one account at a time.</p>
        {error && <p className="account-error" role="alert">{error}</p>}
        <button ref={firstButton} className="add-account-submit" disabled={loading} onClick={() => void onConnectCodex()}>{loading ? "Reading Codex quota…" : codexConnected ? "Refresh local Codex account" : "Connect local Codex"}</button>
      </> : selected === "workbuddy" ? browserPanel("workbuddy") : selected === "zcode" ? browserPanel("zcode") : <>
        <p className="account-hint">Choose a platform to connect your account.</p>
        <div className="platform-options">
          <button ref={firstButton} className="platform-option provider-codex" onClick={() => setSelected("codex")}><span className="platform-mark">O</span><span>OpenAI Codex</span><span className="platform-chevron"><Icon name="chevron" /></span></button>
          <button className="platform-option provider-workbuddy" onClick={() => setSelected("workbuddy")}><span className="platform-mark">W</span><span>WorkBuddy</span><span className="platform-chevron"><Icon name="chevron" /></span></button>
          <button className="platform-option provider-zcode" onClick={() => setSelected("zcode")}><span className="platform-mark">Z</span><span>ZCode</span><span className="platform-chevron"><Icon name="chevron" /></span></button>
          <button className="platform-option provider-claude" disabled><span className="platform-mark">C</span><span>Claude · Coming soon</span></button>
        </div>
      </>}
    </section>
  );
}
