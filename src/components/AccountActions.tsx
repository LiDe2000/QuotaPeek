import { useEffect, useId, useRef, useState } from "react";
import type { Account } from "../types/quota";
import { accountLabel } from "../types/quota";
import { providerName } from "../lib/providerGroups";

interface ConfirmationProps {
  account: Account;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RemovalConfirmation({ account, busy, error, onConfirm, onCancel }: ConfirmationProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!busy) cancel.current?.focus(); }, [busy]);
  return <section className="account-removal" role="alertdialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    aria-busy={busy} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); if (!busy) onCancel(); } }}>
    <h2 id={titleId}>Remove account?</h2>
    <p className="removal-account-name">{accountLabel(account) || providerName[account.providerId]}</p>
    <p id={descriptionId}>{account.providerId === "codex"
      ? "Disconnect from QuotaPeek and delete its quota cache. Codex stays signed in."
      : "Saved login and quota cache will be deleted from QuotaPeek. Your browser stays signed in."}</p>
    {error && <p className="removal-error" role="alert">{error}</p>}
    <div className="removal-buttons">
      <button type="button" ref={cancel} disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className="remove-account-button" disabled={busy} onClick={onConfirm}>{busy ? "Removing…" : "Remove account"}</button>
    </div>
  </section>;
}

export default function AccountActions({ account, disabled, onRemove }: {
  account: Account; disabled: boolean; onRemove: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  function dismiss() {
    setConfirming(false);
    setError(null);
    trigger.current?.focus();
  }
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await onRemove()) setConfirming(false);
      else setError("Could not remove this account. Please retry.");
    } catch { setError("Could not remove this account. Please retry."); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="account-remove-trigger" ref={trigger} aria-label="Remove account" title="Remove account"
      disabled={disabled || busy} onClick={() => setConfirming(true)}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
    </button>
    {confirming && <RemovalConfirmation account={account} busy={busy} error={error} onConfirm={() => void confirm()} onCancel={dismiss} />}
  </>;
}
