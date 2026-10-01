import { useEffect, useRef, useState } from "react";

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 200;

/** A short grace period lets the pointer cross from a ring into its preview. */
export function useHoverPreview() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const opening = useRef<number | null>(null);
  const closing = useRef<number | null>(null);
  const shown = useRef<string | null>(null);
  function clearTimers() {
    if (opening.current !== null) window.clearTimeout(opening.current);
    if (closing.current !== null) window.clearTimeout(closing.current);
    opening.current = null;
    closing.current = null;
  }
  function enter(id: string) {
    clearTimers();
    if (shown.current === id) return;
    opening.current = window.setTimeout(() => {
      opening.current = null;
      shown.current = id;
      setAccountId(id);
    }, OPEN_DELAY_MS);
  }
  function leave() {
    clearTimers();
    closing.current = window.setTimeout(() => {
      closing.current = null;
      shown.current = null;
      setAccountId(null);
    }, CLOSE_DELAY_MS);
  }
  function keep() { clearTimers(); }
  function hide() {
    clearTimers();
    shown.current = null;
    setAccountId(null);
  }
  useEffect(() => clearTimers, []);
  return { accountId, enter, leave, keep, hide };
}
