import type { StatusTone } from "@/components/business/status-tone";
import type { InsightTone } from "@/components/shared/insight-card";
import type { IntegrityStatus } from "@/services/inventory-integrity-service";
import type { MessageKey } from "@/i18n/translate";

/**
 * R13 inventory integrity report — colour follows meaning: PASS green, WARN
 * (reported for review, never auto-corrected) amber, FAIL red.
 */
export const INTEGRITY_STATUS_TONE: Record<IntegrityStatus, StatusTone & InsightTone> = {
  PASS: "success",
  WARN: "warning",
  FAIL: "destructive",
};

export const INTEGRITY_STATUSES: IntegrityStatus[] = ["PASS", "WARN", "FAIL"];

/** The API needs `inventory.view` AND a costing permission (same keys as the stock-card cost rule). */
export const INTEGRITY_VIEW_PERMISSION = "inventory.view";

/** `subledgerValue` → "Subledger value" (metric keys are stable API identifiers, shown LTR). */
export function humanizeMetricKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Translated metric name; a metric the dictionary does not know yet falls back to `humanizeMetricKey`. */
export function integrityMetricLabel(t: (key: MessageKey) => string, key: string): string {
  const messageKey = `inventoryIntegrity.metricLabels.${key}` as MessageKey;
  const label = t(messageKey);
  return label === messageKey ? humanizeMetricKey(key) : label;
}

/** File name of the JSON export: `inventory-integrity-2026-10-06T10-15-00.json`. */
export function integrityExportFileName(generatedAt: string): string {
  return `inventory-integrity-${generatedAt.slice(0, 19).replace(/:/g, "-")}.json`;
}
