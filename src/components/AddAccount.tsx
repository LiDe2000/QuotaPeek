import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { workbuddyErrorMessage, pollWorkbuddyLogin, startWorkbuddyLogin, cancelWorkbuddyLogin } from "../services/workbuddy";
import { pollZcodeLogin, startZcodeLogin, zcodeErrorMessage, cancelZcodeLogin } from "../services/zcode";
import type { ZcodeSite } from "../services/zcode";
import "./AddAccount.css";
type Platform = "codex" | "workbuddy" | "zcode";
type BrowserPlatform = "workbuddy" | "zcode";
type Phase = "idle" | "starting" | "waiting" | "reading" | "cancelling";
interface Flow { provider: BrowserPlatform; state: string; startedAt: number }
interface AddAccountProps {
  hidden: boolean;
  codexConnected: boolean;
  onConnectCodex: () => Promise<boolean>;
  onConnectWorkbuddy: (accountId: string) => Promise<boolean>;
  onConnectZcode: (accountId: string) => Promise<boolean>;
  onClose: () => void;
}
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const BROWSER_COPY = {
  workbuddy: { name: "WorkBuddy", mark: "W", hint: "Sign in through the WorkBuddy page opened in your browser. Each account is saved separately." },
  zcode: { name: "ZCode", mark: "Z", hint: "Choose Z.ai (global) or BigModel (China), then sign in through the authorization page. Each account is saved separately." },
};
function cancelFlow(flow: Flow) {
  return flow.provider === "workbuddy" ? cancelWorkbuddyLogin(flow.state) : cancelZcodeLogin(flow.state);
}

export default function AddAccount({ hidden, codexConnected, onConnectCodex, onConnectWorkbuddy, onConnectZcode, onClose }: AddAccountProps) {
  const [selected, setSelected] = useState<Platform | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [flow, setFlow] = useState<Flow | null>(null);
  const [waitedMs, setWaitedMs] = useState(0);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<{ provider: BrowserPlatform; id: string } | null>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const flowRef = useRef<Flow | null>(null);
  const callbacks = useRef({ onConnectCodex, onConnectWorkbuddy, onConnectZcode });
  callbacks.current = { onConnectCodex, onConnectWorkbuddy, onConnectZcode };
  flowRef.current = flow;
  useEffect(() => { if (!hidden) firstButton.current?.focus(); }, [hidden, selected]);
  useEffect(() => () => {
    generation.current++;
    if (flowRef.current) void cancelFlow(flowRef.current).catch(() => {});
  }, []);

  async function readBrowserAccount(provider: BrowserPlatform, id: string, version: number) {
    setPhase("reading");
    try {
      const ok = provider === "workbuddy" ? await callbacks.current.onConnectWorkbuddy(id) : await callbacks.current.onConnectZcode(id);
      if (generation.current !== version) return;
      if (ok) { setSignedIn(null); setSelected(null); }
      else setLoginError("Sign-in saved, but quota could not be read. Retry the quota query below.");
    } catch (failure) {
      if (generation.current === version) setLoginError(workbuddyErrorMessage(failure));
    } finally {
      if (generation.current === version) { busy.current = false; setPhase("idle"); }
    }
  }

  useEffect(() => {
    if (!flow) return;
    let stopped = false;
    let timer = 0;
    const version = generation.current;
    const ticker = window.setInterval(() => setWaitedMs(Date.now() - flow.startedAt), 1000);
    async function poll() {
      if (stopped || version !== generation.current) return;
      if (Date.now() - flow!.startedAt >= POLL_TIMEOUT_MS) {
        if (await cancel()) setLoginError("Sign-in timed out. Start again when ready.");
        return;
      }
      try {
        const result = flow!.provider === "workbuddy" ? await pollWorkbuddyLogin(flow!.state) : await pollZcodeLogin(flow!.state);
        if (stopped || version !== generation.current) return;
        if (result.status === "success") {
          if (!result.accountId) throw new Error("No account identity came back. Start sign-in again.");
          setFlow(null);
          const account = { provider: flow!.provider, id: result.accountId };
          setSignedIn(account);
          await readBrowserAccount(account.provider, account.id, version);
          return;
        }
        if (result.status === "error") throw new Error(result.message ?? "Sign-in failed. Start again.");
        // One request at a time, with a pause after the response.
        timer = window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
      } catch (failure) {
        if (stopped || version !== generation.current) return;
        setLoginError(flow!.provider === "workbuddy" ? workbuddyErrorMessage(failure) : zcodeErrorMessage(failure));
        void cancelFlow(flow!).catch(() => {});
        setFlow(null);
        busy.current = false;
        setPhase("idle");
      }
    }
    timer = window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
    return () => { stopped = true; clearTimeout(timer); clearInterval(ticker); };
  }, [flow]);

  async function cancel() {
    const pending = flowRef.current;
    generation.current++;
    setPhase("cancelling");
    try {
      const completed = pending ? await cancelFlow(pending) : null;
      setFlow(null);
      if (pending && completed) {
        const account = { provider: pending.provider, id: completed };
        setSignedIn(account);
        setLoginError(null);
        await readBrowserAccount(account.provider, account.id, generation.current);
        return false;
      }
      busy.current = false;
      setPhase("idle");
      setLoginError("Sign-in cancelled. Start again when ready.");
      return true;
    } catch (failure) {
      setLoginError(`Could not cancel sign-in: ${workbuddyErrorMessage(failure)}`);
      setPhase("waiting");
      if (pending) setFlow({ ...pending });
      return false;
    }
  }

  async function beginBrowserLogin(provider: BrowserPlatform, site?: ZcodeSite) {
    if (busy.current) return;
    busy.current = true;
    const version = ++generation.current;
    setPhase("starting");
    setLoginError(null);
    setSignedIn(null);
    setWaitedMs(0);
    let pending: Flow | null = null;
    try {
      const start = provider === "workbuddy" ? await startWorkbuddyLogin() : await startZcodeLogin(site ?? "zai");
      pending = { provider, state: start.state, startedAt: Date.now() };
      if (version !== generation.current) { await cancelFlow(pending); return; }
      flowRef.current = pending;
      setFlow(pending);
      setPhase("waiting");
      await openUrl(start.authUrl);
    } catch (failure) {
      if (pending) await cancelFlow(pending).catch(() => {});
      if (version === generation.current) {
        setFlow(null);
        busy.current = false;
        setPhase("idle");
        setLoginError(provider === "workbuddy" ? workbuddyErrorMessage(failure) : zcodeErrorMessage(failure));
      }
    }
  }

  async function connectCodex() {
    if (busy.current) return;
    busy.current = true;
    setPhase("reading");
    setLoginError(null);
    try {
      if (await callbacks.current.onConnectCodex()) setSelected(null);
      else setLoginError("Could not read local Codex quota. Check your Codex login and retry.");
    } catch (failure) { setLoginError(workbuddyErrorMessage(failure)); }
    finally { busy.current = false; setPhase("idle"); }
  }
  const waiting = phase !== "idle";
  const browserPanel = (provider: BrowserPlatform) => {
    const copy = BROWSER_COPY[provider];
    return <>
      <div className={`selected-platform provider-${provider}`}>
        <span className="platform-mark" aria-hidden="true">{copy.mark}</span><strong>{copy.name}</strong>
        <button className="change-platform" disabled={waiting} onClick={() => { setSelected(null); setLoginError(null); setSignedIn(null); }}>Change</button>
      </div>
      <p className="account-hint">{copy.hint}</p>
      {waiting && <p className="account-hint" role="status">{phase === "starting" ? "Starting sign-in…"
        : phase === "reading" ? "Reading account quota…" : phase === "cancelling" ? "Cancelling sign-in…"
        : `Waiting for sign-in… ${Math.floor(waitedMs / 1000)}s elapsed. You can hide this panel and return while sign-in continues.`}</p>}
      {loginError && <p className="account-error" role="alert">{loginError}</p>}
      {waiting ? <button ref={firstButton} className="add-account-submit" disabled={phase === "reading" || phase === "cancelling"} onClick={() => void cancel()}>Cancel sign-in</button>
        : signedIn?.provider === provider ? <button ref={firstButton} className="add-account-submit" onClick={() => {
          if (busy.current) return;
          busy.current = true;
          setLoginError(null);
          void readBrowserAccount(provider, signedIn.id, generation.current);
        }}>Retry quota query</button>
        : provider === "zcode" ? <div className="site-choices">
          <button ref={firstButton} className="add-account-submit" onClick={() => void beginBrowserLogin(provider, "zai")}>Continue with Z.ai · Global</button>
          <button className="add-account-submit is-secondary" onClick={() => void beginBrowserLogin(provider, "bigmodel")}>Continue with BigModel · China</button>
        </div> : <button ref={firstButton} className="add-account-submit" onClick={() => void beginBrowserLogin(provider)}>Sign in with browser</button>}
    </>;
  };

  return <section id="add-account" className="panel add-account-panel" hidden={hidden} aria-labelledby="add-account-title" aria-busy={waiting} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <div className="add-account-heading">
      <div><p className="account-step">{selected ? "STEP 2 OF 2" : "STEP 1 OF 2"}</p><h2 id="add-account-title">Connect account</h2></div>
    </div>
    {selected === "codex" ? <>
      <div className="selected-platform provider-codex"><span className="platform-mark" aria-hidden="true">O</span><strong>Codex</strong>
        <button className="change-platform" disabled={waiting} onClick={() => { setSelected(null); setLoginError(null); }}>Change</button></div>
      <p className="account-hint">Connect the ChatGPT account currently signed in to Codex on this computer. Sign in to Codex first; this local login supports one account at a time.</p>
      {loginError && <p className="account-error" role="alert">{loginError}</p>}
      <button ref={firstButton} className="add-account-submit" disabled={waiting} onClick={() => void connectCodex()}>{waiting ? "Reading Codex quota…" : codexConnected ? "Refresh local Codex account" : "Connect local Codex"}</button>
    </> : selected === "workbuddy" ? browserPanel("workbuddy") : selected === "zcode" ? browserPanel("zcode") : <>
      <p className="account-hint">Choose a platform to connect an account. WorkBuddy and ZCode support multiple accounts.</p>
      <div className="platform-options">
        <button ref={firstButton} className="platform-option provider-codex" onClick={() => { setSelected("codex"); setLoginError(null); }}><span className="platform-mark">O</span><span>Codex</span></button>
        <button className="platform-option provider-workbuddy" onClick={() => { setSelected("workbuddy"); setLoginError(null); }}><span className="platform-mark">W</span><span>WorkBuddy</span></button>
        <button className="platform-option provider-zcode" onClick={() => { setSelected("zcode"); setLoginError(null); }}><span className="platform-mark">Z</span><span>ZCode</span></button>
      </div>
    </>}
  </section>;
}
