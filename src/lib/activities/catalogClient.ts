import { parseCatalog, normalize, isMock, active, sampleAccount, validateOperation } from "./catalog";
import type { ActivityCatalog, ActivityDefinition, Operation } from "./catalog";
export interface CatalogLoad {
  catalog: ActivityCatalog | null; source: "server" | "local" | null; notice: string | null; session?: string;
}
export async function readJson(url: string, init: RequestInit = {}, signal?: AbortSignal, timeoutMs = 5000) {
  const timeout = new AbortController();
  const stop = () => timeout.abort();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(stop, timeoutMs);
  try {
    const response = await fetch(url, {...init, signal: timeout.signal, credentials: "omit", redirect: "error", cache: "no-store"});
    if (!response.ok) throw Error("Activity request failed.");
    const reader = response.body?.getReader();
    if (!reader) throw Error("Empty activity response.");
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 1_000_000) throw Error("Activity response is too large.");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)) as unknown;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); }
}
export async function fetchCatalog(url: string, readLocal: () => Promise<unknown>, signal?: AbortSignal): Promise<CatalogLoad> {
  signal?.throwIfAborted();
  if (url) {
    try {
      const source = new URL(url);
      if (source.username || source.password || source.hash || source.protocol !== "https:" && !(source.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(source.hostname))) throw Error("Invalid configuration service URL.");
      const catalog = parseCatalog(await readJson(url, {headers: {Accept: "application/json"}}, signal));
      return {catalog, source: "server", notice: null};
    } catch { signal?.throwIfAborted(); }
  }
  try {
    const catalog = parseCatalog(await readLocal()); signal?.throwIfAborted();
    return {catalog, source: "local", notice: url ? "Configuration service unavailable or invalid; using local activities.json." : "Using local activities.json."};
  } catch {
    signal?.throwIfAborted();
    return {catalog: null, source: null, notice: "No usable activity configuration. Check the service or local activities.json."};
  }
}
/** Browser development preview only. Real-account execution exists exclusively in Rust. */
export async function requestMockActivity(definition: ActivityDefinition, accountId: string, claiming: boolean, demo: boolean, signal?: AbortSignal) {
  if (!demo || !isMock(definition) || !sampleAccount(definition.providerId, accountId) || !active(definition)) throw Error("Mock activities require an active sample activity and matching sample account.");
  const run = async (operation: Operation, claim: boolean) => {
    validateOperation(definition, operation, claim);
    const url = new URL(operation.request.url);
    for (const [key,value] of Object.entries(operation.request.query ?? {})) url.searchParams.set(key, value);
    if (!claim) url.searchParams.set("account_id", accountId);
    const payload = await readJson(url.toString(), { method: operation.request.method,
      ...(claim ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify({account_id: accountId})} : {}) }, signal, operation.request.timeoutMs);
    return normalize(payload, operation, claim);
  };
  if (!claiming) return run(definition.query, false);
  if (!definition.claim) throw Error("This activity has no claim operation.");
  const before = await run(definition.query, false);
  if (before.status !== "available") return before;
  let result;
  try { result = await run(definition.claim, true); }
  catch { result = {status: "pending" as const, note: "Claim result unconfirmed. Refresh before retrying."}; }
  if (result.status === "claimed" || result.status === "pending") {
    try { const verified = await run(definition.query, false); if (verified.status === "claimed") return verified; } catch { /* keep pending */ }
    return {status: "pending" as const, note: "Claim submitted; completion is not confirmed. Refresh before retrying."};
  }
  return result;
}
