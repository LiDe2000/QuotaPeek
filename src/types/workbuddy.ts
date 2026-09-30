export interface WorkbuddyPackage {
  name: string;
  remain: number;
  used: number;
  size: number;
  endTime: string | null;
}
export interface WorkbuddyAccount {
  id: "workbuddy-oauth";
  providerId: "workbuddy";
  source: "workbuddy-billing";
  uid: string | null;
  nickname: string | null;
  region: "cn" | "global";
  fetchedAt: number;
  totalRemain: number;
  totalUsed: number;
  totalSize: number;
  packages: WorkbuddyPackage[];
}
