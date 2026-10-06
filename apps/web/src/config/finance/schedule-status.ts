import type { StatusTone } from "@/components/business/status-tone";

/** Lifecycle badge tones for fixed assets and prepaid expenses (list + detail share them). */
export const fixedAssetStatusTone: Record<"DRAFT" | "CAPITALIZED" | "DISPOSED", StatusTone> = {
  DRAFT: "neutral",
  CAPITALIZED: "success",
  DISPOSED: "destructive",
};

export const prepaidStatusTone: Record<"DRAFT" | "ACTIVE" | "COMPLETED" | "CANCELLED", StatusTone> =
  {
    DRAFT: "neutral",
    ACTIVE: "success",
    COMPLETED: "info",
    CANCELLED: "neutral",
  };
