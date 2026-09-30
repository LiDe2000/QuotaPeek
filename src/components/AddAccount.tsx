import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import Icon from "./Icon";
import { workbuddyErrorMessage, pollWorkbuddyLogin, startWorkbuddyLogin } from "../services/workbuddy";
import "./AddAccount.css";
type Platform = "codex" | "workbuddy";
interface AddAccountProps {
  codexConnected: boolean;
  workbuddyConnected: boolean;
  loading: boolean;
  error: string | null;
  onConnectCodex: () => Promise<boolean>;
  onConnectWorkbuddy: () => Promise<boolean>;
  onClose: () => void;
}
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
export default function AddAccount({ codexConnected, workbuddyConnected, loading, error, onConnectCodex, onConnectWorkbuddy, onClose }: AddAccountProps) {
  const [selected, setSelected] = useState<Platform | null>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstButton.current?.focus(); }, [selected]);
  // WorkBuddy sign-in: state request, browser hand-off, then token polling.
  const [loginState, setLoginState] = useState<string | null>(null);
  const [waitedMs, setWaitedMs] = useState(0);
  const [loginError, setLoginError] = useState<string | null>(null);
  const callbacks = useRef({ onConnectWorkbuddy, onClose });
  callbacks.current = { onConnectWorkbuddy, onClose };
  useEffect(() => {
    if (!loginState) return;
    let cancelled = false;
    const ticker = window.setInterval(() => setWaitedMs(ms => ms + POLL_INTERVAL_MS), POLL_INTERVAL_MS);
    const poller = window.setInterval(() => {
      void (async () => {
        try {
          const result = await pollWorkbuddyLogin(loginState);
          if (cancelled) return;
          if (result.status === "success") {
            stopWaiting();
            if (await callbacks.current.onConnectWorkbuddy()) callbacks.current.onClose();
          } else if (result.status === "error") {
            setLoginError(result.message ?? "Sign-in failed. Start again.");
            stopWaiting();
          }
        } catch (failure) {
          if (!cancelled) { setLoginError(workbuddyErrorMessage(failure)); stopWaiting(); }
        }
      })();
    }, POLL_INTERVAL_MS);
    function stopWaiting() {
      cancelled = true;
      window.clearInterval(ticker);
      window.clearInterval(poller);
      setLoginState(null);
    }
    return () => { cancelled = true; window.clearInterval(ticker); window.clearInterval(poller); };
  }, [loginState]);
  useEffect(() => {
    if (waitedMs >= POLL_TIMEOUT_MS && loginState) { setLoginError("Sign-in timed out. Start again and complete it within 10 minutes."); setLoginState(null); }
  }, [waitedMs, loginState]);
  async function beginWorkbuddyLogin() {
    setLoginError(null);
    setWaitedMs(0);
    try {
      const start = await startWorkbuddyLogin();
      setLoginState(start.state);
      await openUrl(start.authUrl);
    } catch (failure) {
      setLoginError(workbuddyErrorMessage(failure));
      setLoginState(null);
    }
  }
  const waiting = loginState !== null;
  const heading = selected ? "STEP 2 OF 2" : "STEP 1 OF 2";
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
      </> : selected === "workbuddy" ? <>
        <div className="selected-platform provider-workbuddy">
          <span className="platform-mark" aria-hidden="true">W</span><strong>WorkBuddy</strong>
          <button className="change-platform" disabled={waiting} onClick={() => setSelected(null)}>Change</button>
        </div>
        <p className="account-hint">Sign in through the official WorkBuddy page opened in your browser. QuotaPeek receives a token using the same flow as the WorkBuddy CLI and keeps it in the app's local data.</p>
        {waiting
          ? <p className="account-hint" role="status">Waiting for sign-in… {Math.round(waitedMs / 1000)}s elapsed. Finish the login in your browser tab; QuotaPeek picks it up automatically.</p>
          : <p className="account-hint">A browser tab opens for the login. QuotaPeek only reads quota afterwards and never auto-refreshes on a timer.</p>}
        {(loginError || error) && <p className="account-error" role="alert">{loginError ?? error}</p>}
        {waiting
          ? <button ref={firstButton} className="add-account-submit" onClick={() => { setLoginState(null); setLoginError("Sign-in cancelled. Start again when ready."); }}>Cancel waiting</button>
          : <button ref={firstButton} className="add-account-submit" disabled={loading} onClick={() => void beginWorkbuddyLogin()}>{workbuddyConnected ? "Sign in again with browser" : "Sign in with browser"}</button>}
      </> : <>
        <p className="account-hint">Choose a platform to connect your account.</p>
        <div className="platform-options">
          <button ref={firstButton} className="platform-option provider-codex" onClick={() => setSelected("codex")}><span className="platform-mark">O</span><span>OpenAI Codex</span><span className="platform-chevron"><Icon name="chevron" /></span></button>
          <button className="platform-option provider-workbuddy" onClick={() => setSelected("workbuddy")}><span className="platform-mark">W</span><span>WorkBuddy</span><span className="platform-chevron"><Icon name="chevron" /></span></button>
          <button className="platform-option provider-claude" disabled><span className="platform-mark">C</span><span>Claude · Coming soon</span></button>
        </div>
      </>}
    </section>
  );
}
