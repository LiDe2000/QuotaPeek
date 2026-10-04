import type { Provider } from "../../lib/providers/providerGroups";
import { providerName } from "../../lib/providers/providerGroups";
import Icon from "../shared/Icon";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";

type LaunchResult = { destination: "local" | "web"; reason: "not-installed" | "launch-failed" | null; download: boolean };

export default function ProviderOpenButton({ provider, disabled = false, tabIndex = 0 }: { provider: Provider; disabled?: boolean; tabIndex?: number }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    if (!notice || error) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice, error]);
  const name = provider === "deepseek" ? "DeepSeek Harness" : providerName[provider];
  async function open() {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setNotice(""); setError(false);
    try {
      const result = await invoke<LaunchResult>("open_provider_app", { provider });
      if (result.destination === "web") setNotice(`${result.reason === "launch-failed" ? "Could not start the app" : "Local app not found"} · Opened ${result.download ? "official download page" : "web version"}.`);
    } catch {
      setError(true); setNotice(`Could not open ${name}. Please retry.`);
    } finally { pending.current = false; setBusy(false); }
  }
  const message = notice && <span className="provider-open-notice" role={error ? "alert" : "status"}>
    {notice}<button type="button" aria-label="Dismiss launch message" onClick={() => setNotice("")}>×</button>
  </span>;
  return <span className="provider-open-control" title={busy ? `Opening ${name}…` : `Open ${name}`}>
    <button type="button" className="provider-open-trigger" tabIndex={tabIndex} aria-label={`Open ${name}`} aria-busy={busy} disabled={disabled || busy} onClick={() => void open()}>
      <Icon name="open-app" />
    </button>
    {message && (typeof document === "undefined" ? message : createPortal(message, document.body))}
  </span>;
}
