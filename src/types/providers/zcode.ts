/** One metered balance bucket from zcode.z.ai: a model's granted units and what is left. */
export interface ZcodeWindow {
  key: string;
  /** The model the bucket meters, e.g. "GLM-5.3-Flash". */
  label: string;
  /** "token" for the coding-plan buckets. */
  unit: string;
  usedPercent: number;
  used: number | null;
  remain: number | null;
  total: number | null;
  resetsAt: number | null;
  /** A one-time grant expires rather than resets. */
  oneTime: boolean;
}
export interface ZcodeAccount {
  id: string;
  providerId: "zcode";
  source: "zcode-billing";
  /** The display name the sign-in carried; there is often no email. */
  email: string | null;
  planName: string | null;
  planDescription: string | null;
  /** "cn" for a BigModel account, "global" for Z.ai. */
  region: "cn" | "global";
  fetchedAt: number;
  windows: ZcodeWindow[];
}
