import { invoke, isTauri } from "@tauri-apps/api/core";
import { fetchCatalog, readJson, requestMockActivity } from "./catalogClient";
import type { CatalogLoad } from "./catalogClient";
import type { ActivityDefinition } from "./catalog";
import { parseActivityResult } from "./catalog";
import { verifyZcode } from "./zcodeVerification";
import type { CaptchaConfig } from "./zcodeVerification";

export async function loadActivities(source: string, demo: boolean, signal: AbortSignal): Promise<CatalogLoad> {
  if (isTauri()) {
    const result = await invoke<CatalogLoad>("activity_load_catalog", {source, demo});
    signal.throwIfAborted();
    return result;
  }
  if (!import.meta.env.DEV || !demo) throw Error("Activity requests require the desktop application.");
  return fetchCatalog(source, () => readJson("/__activities/local", {}, signal), signal);
}
export async function requestActivity(session: string, definition: ActivityDefinition, accountId: string, claiming: boolean, demo: boolean, signal?: AbortSignal) {
  if (isTauri()) {
    signal?.throwIfAborted();
    if (claiming && !demo && definition.adapterId === "zcode-plan-v1") {
      const preparation = await invoke<{status: string; note: string; ticket: string | null; captcha: CaptchaConfig | null}>("activity_prepare_zcode_claim", {
        sessionId: session, activityId: definition.id, accountId,
      });
      if (!preparation.ticket || !preparation.captcha) return parseActivityResult(preparation, true);
      let captchaVerifyParam: string | null = null;
      try { signal?.throwIfAborted(); captchaVerifyParam = await verifyZcode(preparation.captcha); signal?.throwIfAborted(); }
      catch { captchaVerifyParam = null; }
      // A failed/interactive verification consumes the ticket without making a claim request.
      return parseActivityResult(await invoke("activity_submit_zcode_claim", {sessionId: session, ticket: preparation.ticket, captchaVerifyParam}), true);
    }
    const result = await invoke("activity_execute", {sessionId: session, activityId: definition.id, accountId, claiming});
    signal?.throwIfAborted();
    return parseActivityResult(result);
  }
  if (!import.meta.env.DEV || !demo) throw Error("Activity requests require the desktop application.");
  return requestMockActivity(definition, accountId, claiming, demo, signal);
}
