import { useRef, useState } from "react";
import type { Account } from "../types/quota";
import { queryCodexQuota, queryErrorMessage } from "../services/codex";
import { workbuddyErrorMessage, queryWorkbuddyQuota } from "../services/workbuddy";
export function useAccounts() {
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef({ codex: false, workbuddy: false });
  const codexIdentity = useRef<{ accountId: string | null; email: string | null } | null>(null);
  function syncLoading() { setLoading(busy.current.codex || busy.current.workbuddy); }
  function merge(next: Account) {
    // One connection per provider; keep Codex first for a stable page order.
    setAccounts(previous => {
      const others = previous.filter(account => account.providerId !== next.providerId);
      return next.providerId === "codex" ? [next, ...others] : [...others, next];
    });
  }
  async function refreshCodex(): Promise<boolean> {
    if (busy.current.codex) return false;
    busy.current.codex = true;
    syncLoading();
    setError(null);
    setNotice(null);
    try {
      const next = await queryCodexQuota();
      const previous = codexIdentity.current;
      if (previous && (previous.accountId !== next.accountId || previous.email !== next.email)) setNotice("Local Codex account changed · Showing the current login");
      codexIdentity.current = { accountId: next.accountId, email: next.email };
      merge(next);
      return true;
    } catch (failure) {
      setError(queryErrorMessage(failure));
      return false;
    } finally { busy.current.codex = false; syncLoading(); }
  }
  async function refreshWorkbuddy(): Promise<boolean> {
    if (busy.current.workbuddy) return false;
    busy.current.workbuddy = true;
    syncLoading();
    setError(null);
    setNotice(null);
    try {
      merge(await queryWorkbuddyQuota());
      return true;
    } catch (failure) {
      setError(workbuddyErrorMessage(failure));
      return false;
    } finally { busy.current.workbuddy = false; syncLoading(); }
  }
  return { accounts, loading, error, notice, refreshCodex, refreshWorkbuddy };
}
