import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Account, ProviderId } from "../types/quota";
import Icon from "./Icon";
import "./AddAccount.css";

const platforms: { id: ProviderId; name: string; mark: string }[] = [
  { id: "codex", name: "OpenAI Codex", mark: "O" },
  { id: "claude", name: "Claude", mark: "C" },
];

interface AddAccountProps {
  accounts: readonly Account[];
  onAdd: (providerId: ProviderId, email: string) => void;
  onClose: () => void;
}

export default function AddAccount({ accounts, onAdd, onClose }: AddAccountProps) {
  const [platform, setPlatform] = useState<ProviderId | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const firstPlatform = useRef<HTMLButtonElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const selected = platforms.find(option => option.id === platform);

  useEffect(() => {
    if (platform) emailInput.current?.focus();
    else firstPlatform.current?.focus();
  }, [platform]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!platform) return;
    const value = email.trim();
    if (accounts.some(account => account.providerId === platform && account.email.toLowerCase() === value.toLowerCase())) {
      setError("This account is already added for this platform.");
      emailInput.current?.focus();
      return;
    }
    onAdd(platform, value);
  }

  return (
    <section id="add-account" className="add-account-panel" aria-labelledby="add-account-title" onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    }}>
      <div className="add-account-heading">
        <div><p className="account-step">{platform ? "STEP 2 OF 2" : "STEP 1 OF 2"}</p><h2 id="add-account-title">Add account</h2></div>
        <button className="icon-button" aria-label="Close add account" onClick={onClose}><Icon name="close" /></button>
      </div>
      {selected ? (
        <form onSubmit={submit}>
          <div className={`selected-platform provider-${selected.id}`}>
            <span className="platform-mark" aria-hidden="true">{selected.mark}</span>
            <strong>{selected.name}</strong>
            <button type="button" className="change-platform" onClick={() => { setPlatform(null); setError(""); }}>Change</button>
          </div>
          <label className="account-input-label" htmlFor="account-email">Account email</label>
          <input ref={emailInput} id="account-email" className="account-email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} value={email} aria-invalid={!!error} aria-describedby={error ? "account-demo-note account-error" : "account-demo-note"} onChange={event => { setEmail(event.target.value); setError(""); }} />
          {error && <p id="account-error" className="account-error" role="alert">{error}</p>}
          <p id="account-demo-note" className="account-hint">Preview only. Adds sample usage without signing in. Accounts added here are cleared when the app reloads.</p>
          <button className="add-account-submit" type="submit">Add demo account</button>
        </form>
      ) : (
        <>
          <p className="account-hint">Choose a platform to preview your account.</p>
          <div className="platform-options">{platforms.map((option, index) => (
            <button ref={index === 0 ? firstPlatform : undefined} key={option.id} className={`platform-option provider-${option.id}`} onClick={() => setPlatform(option.id)}>
              <span className="platform-mark" aria-hidden="true">{option.mark}</span>
              <span>{option.name}</span><span className="platform-chevron"><Icon name="chevron" /></span>
            </button>
          ))}</div>
        </>
      )}
    </section>
  );
}
