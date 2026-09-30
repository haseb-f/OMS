import type { StatusTone } from "@/components/business/status-tone";
import type { WorkflowTrackerState } from "@/components/shared/workflow-tracker";
import type { MessageKey } from "@/i18n/translate";
import {
  claimVerificationTerm,
  declaredStatusTone as vocabularyDeclaredTone,
  paymentTerm,
} from "@/config/payments/payment-vocabulary";
import type {
  ClaimVerification,
  DeclaredPaymentStatus,
  FinancePaymentStatus,
  PortalEntryType,
  PortalFulfillmentCounts,
  PortalPaymentStage,
} from "@/services/agent-portal-service";

/**
 * Agent-portal vocabulary: label keys and tones for the statuses an agent
 * sees. Declared (what sales reported) and Finance-verified are always two
 * different labels — a declaration is never shown as "verified".
 */

export const DECLARED_STATUSES: DeclaredPaymentStatus[] = ["UNPAID", "PARTIALLY_PAID", "PAID"];

export const FINANCE_STATUSES: FinancePaymentStatus[] = [
  "PAYMENT_PENDING",
  "PARTIALLY_PAID",
  "FULLY_PAID_RECONCILED",
  "OVERPAID",
  "UNMATCHED",
  "PAYMENT_REVIEW",
];

/** Store-order fulfillment status codes an agent order can carry. */
export const FULFILLMENT_STATUS_CODES = [
  "AWAITING_PREPARATION",
  "UNFULFILLED",
  "READY",
  "READY_FOR_PICKUP",
  "COLLECTED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;

/** The protected LEAD workflow codes (apps/api workflow.catalog.ts). */
export const LEAD_STATUS_CODES = [
  "NEW",
  "IN_PROGRESS",
  "QUALIFIED",
  "CONVERTED",
  "LOST",
  "DISQUALIFIED",
] as const;

/** Declared (not verified) — the shared payment vocabulary's "declared" tone. */
export function declaredStatusTone(status: DeclaredPaymentStatus): StatusTone {
  return vocabularyDeclaredTone(status);
}

export function financeStatusTone(status: FinancePaymentStatus): StatusTone {
  switch (status) {
    case "FULLY_PAID_RECONCILED":
      return "success";
    case "PARTIALLY_PAID":
    case "PAYMENT_REVIEW":
      return "warning";
    case "OVERPAID":
    case "UNMATCHED":
      return "destructive";
    default:
      return "neutral";
  }
}

/** A claim's Finance state, toned by the shared payment vocabulary (rejected = neutral, disputed = destructive). */
export function verificationTone(verification: ClaimVerification): StatusTone {
  return paymentTerm(claimVerificationTerm(verification)).tone;
}

export function paymentStageTone(stage: PortalPaymentStage): StatusTone {
  switch (stage) {
    case "REJECTED":
    case "REVERSED":
      return "destructive";
    case "AVAILABLE":
    case "PAID_OUT":
      return "success";
    case "COLLECTED_BY_AGENT":
      return "neutral";
    case "DECLARED":
    case "HELD_WITH_PROVIDER":
    case "PENDING_ELIGIBILITY":
      return "warning";
    default:
      return "info";
  }
}

/** Known codes get the portal's own label; anything else falls back to the catalog name. */
export function fulfillmentCodeLabelKey(code: string | null | undefined): MessageKey | null {
  return code && (FULFILLMENT_STATUS_CODES as readonly string[]).includes(code)
    ? (`agentPortal.status.fulfillmentCodes.${code}` as MessageKey)
    : null;
}

export function leadCodeLabelKey(code: string | null | undefined): MessageKey | null {
  return code && (LEAD_STATUS_CODES as readonly string[]).includes(code)
    ? (`agentPortal.status.leadCodes.${code}` as MessageKey)
    : null;
}

export function entryTypeLabelKey(type: PortalEntryType): MessageKey {
  return `agentPortal.statement.entryType.${type}` as MessageKey;
}

/** A lead can be converted while it has no order and is not closed (LOST / DISQUALIFIED). */
export function canConvertLead(lead: { status: { code: string }; storeOrder: unknown }): boolean {
  return !lead.storeOrder && lead.status.code !== "LOST" && lead.status.code !== "DISQUALIFIED";
}

// ── Fulfillment progress ──────────────────────────────────────────────────

export const FULFILLMENT_STAGE_KEYS = ["created", "dispatched", "completed"] as const;
export type FulfillmentStageKey = (typeof FULFILLMENT_STAGE_KEYS)[number];

/**
 * Where an order is on the agent's path (created → dispatched → completed),
 * from the server's own dispatch / earning timestamps. A cancelled order is
 * an off-path terminal state.
 */
export function fulfillmentProgress(order: {
  dispatchedAt: string | null;
  earnedAt: string | null;
  statusCode: string | null | undefined;
}): { current: FulfillmentStageKey; complete: boolean; cancelled: boolean } {
  const cancelled = order.statusCode === "CANCELLED";
  if (order.earnedAt) return { current: "completed", complete: true, cancelled };
  if (order.dispatchedAt) return { current: "dispatched", complete: false, cancelled };
  return { current: "created", complete: false, cancelled };
}

/** Digital-only orders (no inventory line) skip shipping: created → completed. */
export const DIGITAL_FULFILLMENT_STAGE_KEYS = ["created", "completed"] as const;

/**
 * Header/status state of a digital-only order: nothing ships, so it reads
 * "digital service — no shipping required" until earned, then "completed".
 * A cancelled order keeps its own fulfillment status (null here).
 */
export function digitalFulfillmentState(order: {
  earnedAt: string | null;
  statusCode: string | null | undefined;
}): {
  labelKey: "agentPortal.orderDetail.digital.pending" | "agentPortal.orderDetail.digital.completed";
  tone: "info" | "success";
} | null {
  if (order.statusCode === "CANCELLED") return null;
  return order.earnedAt
    ? { labelKey: "agentPortal.orderDetail.digital.completed", tone: "success" }
    : { labelKey: "agentPortal.orderDetail.digital.pending", tone: "info" };
}

export function cancelledTrackerState(label: string): WorkflowTrackerState {
  return { label, tone: "destructive", placement: "after" };
}

/** Dashboard stage bars: each bucket's share of all orders (0–100, whole numbers). */
export const DASHBOARD_STAGE_KEYS = [
  "awaitingDispatch",
  "dispatched",
  "completed",
  "withReturns",
  "cancelled",
] as const satisfies readonly (keyof PortalFulfillmentCounts)[];

export function stageShares(
  counts: PortalFulfillmentCounts,
): { key: (typeof DASHBOARD_STAGE_KEYS)[number]; count: number; percent: number }[] {
  return DASHBOARD_STAGE_KEYS.map((key) => ({
    key,
    count: counts[key],
    percent: counts.total > 0 ? Math.round((counts[key] / counts.total) * 100) : 0,
  }));
}

/** Name in the UI language when the record carries an English name. */
export function localizedName(
  record: { name: string; nameEn?: string | null; displayName?: string | null } | null | undefined,
  locale: "ar" | "en",
): string {
  if (!record) return "";
  if (locale === "en" && record.nameEn) return record.nameEn;
  return record.displayName || record.name;
}
