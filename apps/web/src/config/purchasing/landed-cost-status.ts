import type { StatusTone } from "@/components/business/status-badge";
import type { LandedCostStatusValue } from "@/services/landed-cost-service";
import type { MessageKey } from "@/i18n/translate";

export const LANDED_COST_STATUS_LABEL_KEY: Record<LandedCostStatusValue, MessageKey> = {
  DRAFT: "purchasing.landedCost.status.draft",
  APPROVED: "purchasing.landedCost.status.approved",
  POSTED: "purchasing.landedCost.status.posted",
  CANCELLED: "purchasing.landedCost.status.cancelled",
};

export const LANDED_COST_STATUS_TONE: Record<LandedCostStatusValue, StatusTone> = {
  DRAFT: "neutral",
  APPROVED: "warning",
  POSTED: "success",
  CANCELLED: "destructive",
};

export const LANDED_COST_FILTERABLE_STATUSES: LandedCostStatusValue[] = [
  "DRAFT",
  "APPROVED",
  "POSTED",
  "CANCELLED",
];

export const LANDED_COST_CANCELLABLE_STATUSES: LandedCostStatusValue[] = ["DRAFT", "APPROVED"];
