import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { startDeepseekLogin, pollDeepseekLogin, cancelDeepseekLogin } from "../services/deepseek";
import PlatformMark from "./PlatformMark";

import { workbuddyErrorMessage, pollWorkbuddyLogin, startWorkbuddyLogin, cancelWorkbuddyLogin } from "../services/workbuddy";
import { pollZcodeLogin, startZcodeLogin, zcodeErrorMessage, cancelZcodeLogin } from "../services/zcode";
import type { ZcodeSite } from "../services/zcode";
import "./AddAccount.css";
type Platform = "codex" | "workbuddy" | "zcode" | "deepseek";
type BrowserPlatform = "workbuddy" | "zcode" | "deepseek";
type Phase = "idle" | "starting" | "waiting" | "reading" | "cancelling";
interface Flow { provider: BrowserPlatform; state: string; startedAt: number }
interface LoginNotice { message: string; tone: "info" | "error" }
interface AddAccountProps {
  hidden: boolean;
  codexConnected: boolean;
  onConnectCodex: () => Promise<boolean>;
  onConnectWorkbuddy: (accountId: string) => Promise<boolean>;
  onConnectZcode: (accountId: string) => Promise<boolean>;
  onConnectDeepseek: (accountId: string) => Promise<boolean>;
  onClose: () => void;
}
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const BROWSER_NAMES = {
  deepseek: "DeepSeek",
  workbuddy: "WorkBuddy",
  zcode: "ZCode",
};
function cancelFlow(flow: Flow) {
  return flow.provider === "deepseek" ? cancelDeepseekLogin(flow.state) : flow.provider === "workbuddy" ? cancelWorkbuddyLogin(flow.state) : cancelZcodeLogin(flow.state);
}

export default function AddAccount({ hidden, codexConnected, onConnectCodex, onConnectWorkbuddy, onConnectZcode, onConnectDeepseek, onClose }: AddAccountProps) {
  const [selected, setSelected] = useState<Platform | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [flow, setFlow] = useState<Flow | null>(null);
  const [waitedMs, setWaitedMs] = useState(0);
  const [loginNotice, setLoginNotice] = useState<LoginNotice | null>(null);
  const [signedIn, setSignedIn] = useState<{ provider: BrowserPlatform; id: string } | null>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const flowRef = useRef<Flow | null>(null);
  function setLoginError(message: string | null) {
    setLoginNotice(message ? { message, tone: "error" } : null);
  }
  const callbacks = useRef({ onConnectCodex, onConnectWorkbuddy, onConnectZcode, onConnectDeepseek });
  callbacks.current = { onConnectCodex, onConnectWorkbuddy, onConnectZcode, onConnectDeepseek };
  flowRef.current = flow;
  useEffect(() => { if (!hidden) firstButton.current?.focus(); }, [hidden, selected]);
  useEffect(() => () => {
    generation.current++;
    if (flowRef.current) void cancelFlow(flowRef.current).catch(() => {});
  }, []);

  async function readBrowserAccount(provider: BrowserPlatform, id: string, version: number) {
    setPhase("reading");
    try {
      const ok = provider === "deepseek" ? await callbacks.current.onConnectDeepseek(id) : provider === "workbuddy" ? await callbacks.current.onConnectWorkbuddy(id) : await callbacks.current.onConnectZcode(id);
      if (generation.current !== version) return;
      if (ok) { setSignedIn(null); setSelected(null); }
      else setLoginError("Signed in. Retry the quota query.");
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
        if (await cancel()) setLoginError("Sign-in timed out. Try again.");
        return;
      }
      try {
        const result = flow!.provider === "deepseek" ? await pollDeepseekLogin(flow!.state) : flow!.provider === "workbuddy" ? await pollWorkbuddyLogin(flow!.state) : await pollZcodeLogin(flow!.state);
        if (stopped || version !== generation.current) return;
        if (result.status === "success") {
          if (!result.accountId) throw new Error("Account not found. Sign in again.");
          setFlow(null);
          const account = { provider: flow!.provider, id: result.accountId };
          setSignedIn(account);
          await readBrowserAccount(account.provider, account.id, version);
          return;
        }
        if (result.status === "error") throw new Error(result.message ?? "Sign-in failed. Try again.");
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
      setLoginNotice({ message: "Sign-in cancelled.", tone: "info" });
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
      const start = provider === "deepseek" ? await startDeepseekLogin() : provider === "workbuddy" ? await startWorkbuddyLogin() : await startZcodeLogin(site ?? "zai");
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
      else setLoginError("Check your Codex login and retry.");
    } catch (failure) { setLoginError(workbuddyErrorMessage(failure)); }
    finally { busy.current = false; setPhase("idle"); }
  }
  const waiting = phase !== "idle";
  const notice = loginNotice && <p className={`account-notice is-${loginNotice.tone}`} role={loginNotice.tone === "error" ? "alert" : "status"}>
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      {loginNotice.tone === "info" ? <path d="M12 11v6m0-10v.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        : <path d="M12 7v6m0 4v.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
    <span>{loginNotice.message}</span>
  </p>;
  const browserPanel = (provider: BrowserPlatform) => {
    return <>
      <div className={`selected-platform provider-${provider}`}>
        <PlatformMark provider={provider} /><strong>{BROWSER_NAMES[provider]}</strong>
        <button className="change-platform" disabled={waiting} onClick={() => { setSelected(null); setLoginError(null); setSignedIn(null); }}>Change</button>
      </div>
      {waiting && <p className="account-progress" role="status">{phase === "starting" ? "Starting sign-in…"
        : phase === "reading" ? "Reading account quota…" : phase === "cancelling" ? "Cancelling sign-in…"
        : `Waiting for sign-in · ${Math.floor(waitedMs / 1000)}s`}</p>}
      {notice}
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
      <h2 id="add-account-title">Connect account</h2>
      <div className="account-step" role="group" aria-label={`Step ${selected ? 2 : 1} of 2`}>
        <span className={`account-step-node ${selected ? "is-complete" : "is-current"}`} aria-current={selected ? undefined : "step"} title="Choose platform">
          {selected ? <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 8 2.5 2.5L12 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg> : "1"}
          <span className="sr-only">Choose platform</span>
        </span>
        <span className={`account-step-connector${selected ? " is-complete" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 18 12" fill="none"><path d="m3 3 3 3-3 3m7-6 3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <span className={`account-step-node${selected ? " is-current" : ""}`} aria-current={selected ? "step" : undefined} title="Connect account">
          2<span className="sr-only">Connect account</span>
        </span>
      </div>
    </div>
    {selected === "deepseek" ? browserPanel("deepseek") : selected === "codex" ? <>
      <div className="selected-platform provider-codex"><PlatformMark provider="codex" /><strong>Codex</strong>
        <button className="change-platform" disabled={waiting} onClick={() => { setSelected(null); setLoginError(null); }}>Change</button></div>
      {notice}
      <button ref={firstButton} className="add-account-submit" disabled={waiting} onClick={() => void connectCodex()}>{waiting ? "Reading Codex quota…" : codexConnected ? "Refresh local Codex" : "Connect local Codex"}</button>
    </> : selected === "workbuddy" ? browserPanel("workbuddy") : selected === "zcode" ? browserPanel("zcode") : <>
      <div className="platform-options">
        <button ref={firstButton} className="platform-option provider-codex" onClick={() => { setSelected("codex"); setLoginError(null); }}><PlatformMark provider="codex" /><span>Codex</span></button>
        <button className="platform-option provider-workbuddy" onClick={() => { setSelected("workbuddy"); setLoginError(null); }}><PlatformMark provider="workbuddy" /><span>WorkBuddy</span></button>
        <button className="platform-option provider-zcode" onClick={() => { setSelected("zcode"); setLoginError(null); }}><PlatformMark provider="zcode" /><span>ZCode</span></button>
        <button className="platform-option provider-deepseek" onClick={() => { setSelected("deepseek"); setLoginError(null); }}><PlatformMark provider="deepseek" /><span>DeepSeek</span></button>
      </div>
    </>}
  </section>;
}
