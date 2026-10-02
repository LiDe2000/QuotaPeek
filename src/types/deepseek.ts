export interface DeepseekBalance {
  currency: "CNY" | "USD";
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
  total_cost?: string | null;
}
export interface DeepseekAccount {
  id: string;
  providerId: "deepseek";
  source: "deepseek-api" | "deepseek-platform";
  label: string;
  contact?: string | null;
  fetchedAt: number;
  isAvailable: boolean;
  balances: DeepseekBalance[];
}
