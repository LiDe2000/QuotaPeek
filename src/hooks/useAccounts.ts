import { useRef, useState } from "react";
import type { Account } from "../types/quota";
import { queryCodexQuota, queryErrorMessage } from "../services/codex";
export function useAccounts() {
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  async function refreshCodex(): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const next = await queryCodexQuota();
      const previous = accounts.find(account => account.providerId === "codex");
      if (previous && (previous.accountId !== next.accountId || previous.email !== next.email)) setNotice("Local Codex account changed · Showing the current login");
      // One local connection: replace the whole snapshot when the login changes.
      setAccounts([next]);
      return true;
    } catch (failure) {
      setError(queryErrorMessage(failure));
      return false;
    } finally { busy.current = false; setLoading(false); }
  }
  return { accounts, loading, error, notice, refreshCodex };
}
