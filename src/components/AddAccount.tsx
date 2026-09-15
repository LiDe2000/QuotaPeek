import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import "./AddAccount.css";
interface AddAccountProps {
  connected: boolean;
  loading: boolean;
  error: string | null;
  onConnect: () => Promise<void>;
  onClose: () => void;
}
export default function AddAccount({ connected, loading, error, onConnect, onClose }: AddAccountProps) {
  const [selected, setSelected] = useState(false);
  const firstButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstButton.current?.focus(); }, [selected]);
  return (
    <section id="add-account" className="panel add-account-panel" aria-labelledby="add-account-title" aria-busy={loading} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    }}>
      <div className="add-account-heading">
        <div><p className="account-step">{selected ? "STEP 2 OF 2" : "STEP 1 OF 2"}</p><h2 id="add-account-title">Connect account</h2></div>
        <button className="icon-button" aria-label="Close add account" onClick={onClose}><Icon name="close" /></button>
      </div>
      {selected ? <>
        <div className="selected-platform provider-codex">
          <span className="platform-mark" aria-hidden="true">O</span><strong>OpenAI Codex</strong>
          <button className="change-platform" disabled={loading} onClick={() => setSelected(false)}>Change</button>
        </div>
        <p className="account-hint">Connect the ChatGPT account currently signed in to Codex on this computer. Your email and quota are read automatically; no password is needed here.</p>
        <p className="account-hint">Sign in to Codex first. This connection follows your local Codex login and supports one account at a time.</p>
        {error && <p className="account-error" role="alert">{error}</p>}
        <button ref={firstButton} className="add-account-submit" disabled={loading} onClick={() => void onConnect()}>{loading ? "Reading Codex quota…" : connected ? "Refresh local Codex account" : "Connect local Codex"}</button>
      </> : <>
        <p className="account-hint">Choose a platform to connect your account.</p>
        <div className="platform-options">
          <button ref={firstButton} className="platform-option provider-codex" onClick={() => setSelected(true)}><span className="platform-mark">O</span><span>OpenAI Codex</span><span className="platform-chevron"><Icon name="chevron" /></span></button>
          <button className="platform-option provider-claude" disabled><span className="platform-mark">C</span><span>Claude · Coming soon</span></button>
        </div>
      </>}
    </section>
  );
}
