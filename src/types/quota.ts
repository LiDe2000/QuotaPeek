export type ProviderId = "codex" | "claude";

export interface QuotaLimit {
  label: string;
  remaining: number;
  reset: string;
  time: string;
}

export interface Account {
  /** Unique account identity, including when accounts share a provider. */
  id: string;
  providerId: ProviderId;
  provider: string;
  mark: string;
  email: string;
  limits: readonly QuotaLimit[];
}
