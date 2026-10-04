import type { Account } from "../../types/quota";
import type { Activity, ActivityEntry, ActivityStatus } from "./activityState";

export interface Condition { path: string; equals: unknown }
export interface Operation {
  request: { url: string; method: "GET" | "POST"; query?: Record<string, string>; body?: Record<string, unknown> | null; timeoutMs?: number };
  response: { rules: { all: Condition[]; status: Exclude<ActivityStatus, "claiming"> }[] };
}
export interface ActivityDefinition {
  id: string; providerId: Activity["providerId"]; title: string; reward: string; description?: string;
  enabled?: boolean; regions?: ("cn" | "global")[];
  adapterId: "mock-http-v1" | "workbuddy-checkin-v1" | "zcode-preview-v1" | "zcode-plan-v1";
  startsAt?: number | null; expiresAt?: number | null; query: Operation; claim?: Operation | null;
}
export interface ActivityCatalog { schemaVersion: 2; revision: string; activities: ActivityDefinition[] }
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const label = (v: unknown, max = 2000): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const statuses = new Set<ActivityStatus>(["unknown", "available", "claimed", "verification", "failed", "pending"]);
function keys(v: Record<string, unknown>, allowed: string[]) { return Object.keys(v).every(k => allowed.includes(k)); }
export function isMock(item: ActivityDefinition) { return item.adapterId === "mock-http-v1"; }
export function active(item: ActivityDefinition, now = Date.now() / 1000) {
  return item.enabled !== false && (item.startsAt == null || now >= item.startsAt) && (item.expiresAt == null || now < item.expiresAt);
}
export function sampleAccount(provider: string, account: string) {
  return (provider === "workbuddy" ? ["preview-wb-0", "preview-wb-1", "preview-wb-2"] : ["preview-zc-0", "preview-zc-1"]).includes(account);
}
export function validateOperation(item: ActivityDefinition, op: unknown, claiming: boolean): asserts op is Operation {
  if (!object(op) || !keys(op, ["request", "response"]) || !object(op.request) || !object(op.response)) throw Error("Invalid activity operation.");
  const r = op.request, mapping = op.response;
  if (!keys(r, ["url", "method", "query", "body", "timeoutMs"]) || !label(r.url)
    || r.timeoutMs !== undefined && (!Number.isInteger(r.timeoutMs) || Number(r.timeoutMs) < 500 || Number(r.timeoutMs) > 30000)
    || r.query !== undefined && (!object(r.query) || Object.keys(r.query).length > 30 || Object.entries(r.query).some(([k,v]) => k.length > 200 || typeof v !== "string" || v.length > 2000))
    || r.body != null && (!object(r.body) || r.method === "GET")) throw Error("Invalid activity request.");
  const url = new URL(r.url);
  let origin: string, path: string, method: string;
  if (isMock(item)) {
    origin = "http://127.0.0.1:1432"; path = "/mock/" + item.providerId + (claiming ? "/claim" : "/status"); method = claiming ? "POST" : "GET";
  } else if (item.adapterId === "workbuddy-checkin-v1" && item.providerId === "workbuddy") {
    origin = "https://copilot.tencent.com"; path = "/v2/billing/meter/" + (claiming ? "daily-checkin" : "checkin-activity-status"); method = "POST";
  } else if (item.adapterId === "zcode-preview-v1" && item.providerId === "zcode" && !claiming) {
    origin = "https://zcode.z.ai"; path = "/api/v1/zcode-plan/billing/preview"; method = "GET";
  } else if (item.adapterId === "zcode-plan-v1" && item.providerId === "zcode") {
    origin = "https://zcode.z.ai"; path = "/api/v1/zcode-plan/billing/" + (claiming ? "claim" : "preview"); method = claiming ? "POST" : "GET";
  } else throw Error("Unsupported activity adapter or operation.");
  if (url.origin !== origin || url.pathname !== path || r.url !== origin + path || r.method !== method) throw Error("Activity endpoint is outside the built-in provider policy.");
  if (item.adapterId === "zcode-plan-v1" && claiming && (Object.keys(r.query ?? {}).length || Object.keys(r.body ?? {}).length)) throw Error("ZCode claim parameters are generated locally.");
  if (!keys(mapping, ["rules"]) || !Array.isArray(mapping.rules) || mapping.rules.length > 30 || mapping.rules.some(rule =>
    !object(rule) || !keys(rule, ["all", "status"]) || !statuses.has(rule.status as ActivityStatus) || !Array.isArray(rule.all)
    || !rule.all.length || rule.all.length > 10 || rule.all.some(c => !object(c) || !keys(c, ["path", "equals"]) || !label(c.path, 200) || !Object.prototype.hasOwnProperty.call(c, "equals")))) throw Error("Invalid activity response rules.");
}
export function parseCatalog(value: unknown): ActivityCatalog {
  if (!object(value) || !keys(value, ["schemaVersion", "revision", "activities"]) || value.schemaVersion !== 2 || !label(value.revision, 200)
    || !Array.isArray(value.activities) || value.activities.length > 100) throw Error("Unsupported activity catalog format.");
  const ids = new Set<string>();
  for (const item of value.activities) {
    if (!object(item) || !keys(item, ["id", "providerId", "title", "reward", "description", "enabled", "regions", "adapterId", "startsAt", "expiresAt", "query", "claim"])
      || typeof item.id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(item.id) || ids.has(item.id)
      || !["workbuddy", "zcode"].includes(String(item.providerId)) || !label(item.title) || !label(item.reward)
      || item.description !== undefined && (typeof item.description !== "string" || item.description.length > 4000)
      || item.enabled !== undefined && typeof item.enabled !== "boolean"
      || item.regions !== undefined && (!Array.isArray(item.regions) || item.regions.length > 2 || item.regions.some(r => r !== "cn" && r !== "global"))
      || [item.startsAt, item.expiresAt].some(t => t != null && (!Number.isSafeInteger(t) || Number(t) < 0))
      || item.startsAt != null && item.expiresAt != null && Number(item.startsAt) >= Number(item.expiresAt)) throw Error("Invalid activity configuration.");
    const definition = item as unknown as ActivityDefinition;
    validateOperation(definition, item.query, false);
    if (item.claim != null) validateOperation(definition, item.claim, true);
    ids.add(item.id);
  }
  return value as unknown as ActivityCatalog;
}
export function catalogActivities(catalog: ActivityCatalog, accounts: readonly Account[], demo: boolean): Activity[] {
  return catalog.activities.filter(item => active(item)).flatMap(item => {
    const members = accounts.filter(account => account.providerId === item.providerId
      && (!item.regions?.length || ("region" in account && item.regions.includes(account.region))));
    if (!members.length) return [];
    return [{ id: item.id, providerId: item.providerId, title: item.title, reward: item.reward, description: item.description,
      entries: members.map(account => ({ accountId: account.id, status: "unknown" as const,
        note: isMock(item) !== demo ? "Sample activities and real accounts cannot be mixed." : undefined })) }];
  });
}
export function parseActivityResult(payload: unknown, claiming = false): Omit<ActivityEntry, "accountId"> {
  if (!object(payload) || !statuses.has(payload.status as ActivityStatus) || payload.note !== undefined && typeof payload.note !== "string") throw Error("Invalid activity status response.");
  const status = payload.status as ActivityStatus;
  return { status: claiming && ["unknown", "available"].includes(status) ? "pending" : status,
    note: typeof payload.note === "string" ? payload.note.slice(0, 2000) : undefined };
}
export function normalize(payload: unknown, operation: Operation, claiming: boolean) {
  const rule = operation.response.rules.find(r => r.all.every(c => {
    const value = c.path.split(".").reduce<unknown>((v, key) => object(v) && Object.prototype.hasOwnProperty.call(v, key) ? v[key] : undefined, payload);
    return value !== undefined && JSON.stringify(value) === JSON.stringify(c.equals);
  }));
  return parseActivityResult({status: rule?.status ?? (claiming ? "pending" : "unknown")}, claiming);
}
