import type { Account } from "../../types/quota";

/** Sample accounts for the browser and native activity development previews. */
export const activityPreviewAccounts: Account[] = [
  ...["Personal", "Research", "Work"].map((nickname, index) => ({
    id: `preview-wb-${index}`, providerId: "workbuddy" as const, source: "workbuddy-billing" as const,
    uid: null, nickname, region: "cn" as const, fetchedAt: Date.now(),
    totalRemain: 1800 + index * 250, totalUsed: 200, totalSize: 2000 + index * 250, packages: [],
  })),
  ...["Personal", "Work"].map((email, index) => ({
    id: `preview-zc-${index}`, providerId: "zcode" as const, source: "zcode-billing" as const,
    email, planName: "Preview plan", planDescription: null, region: "global" as const, fetchedAt: Date.now(),
    windows: [{ key: "preview-flash", label: "GLM-5.3-Flash", unit: "token", usedPercent: 25,
      used: 25000000, remain: 75000000, total: 100000000, resetsAt: Date.now() + 3600000, oneTime: true }],
  })),
];
