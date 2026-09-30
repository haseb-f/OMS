import { apiClient } from "./api-client";

/**
 * Round 5 Spec 1A — guided order amendments. The same two-step contract on
 * the internal Store Orders API and the agent portal: preview (no writes) →
 * commit with the previewed `version`, a reason and the acknowledgements.
 */
export type AmendmentSeverity = "BLOCKING" | "ACKNOWLEDGE" | "INFO";

export interface AmendmentImpact {
  code: string;
  severity: AmendmentSeverity;
  /** English fallback — the UI renders the localized text from `code` + `params`. */
  message: string;
  params: Record<string, string | number | null>;
}

export interface AmendmentLineChange {
  itemId?: string;
  productId: string;
  quantity: number;
  agreedAmount?: number;
}

export interface AmendmentChanges {
  customer?: { partnerId?: string; name?: string; phone?: string; email?: string };
  items?: AmendmentLineChange[];
  currencyId?: string;
  paymentType?: "PREPAID" | "CASH_ON_DELIVERY";
  fulfillmentMethod?: "SHIPPING" | "PICKUP";
  destination?: { countryId?: string; city?: string; address?: string };
  pricingMode?: "SHIPPING_ADDED" | "SHIPPING_INCLUDED";
  agreedTotal?: number;
}

export interface AmendmentPreview {
  orderId: string;
  version: number;
  canCommit: boolean;
  impacts: AmendmentImpact[];
  requiredAcknowledgements: string[];
  totals: { currency: string; previous: string; next: string };
}

export interface AmendmentCommitInput {
  changes: AmendmentChanges;
  expectedVersion: number;
  reason: string;
  acknowledgements: string[];
}

export interface AmendmentCommitResult<TOrder> {
  amendmentId: string;
  version: number;
  impacts: AmendmentImpact[];
  invoiceRegeneration: {
    regenerated: boolean;
    invoiceNumber?: string;
    message?: string;
  } | null;
  order: TOrder;
}

export interface AmendmentLineDiff {
  kind: "ADDED" | "REMOVED" | "CHANGED";
  productId: string;
  product?: string;
  old?: { productId?: string; quantity: number; agreedAmount: string };
  new?: { productId?: string; quantity: number; agreedAmount: string };
}

export interface AmendmentHistoryRow {
  id: string;
  version: number;
  reason: string;
  actorType: "INTERNAL" | "AGENT";
  actorName: string | null;
  createdAt: string;
  changes: {
    fields: Record<string, { old: unknown; new: unknown }>;
    lines: AmendmentLineDiff[];
  };
  impacts: { impacts: AmendmentImpact[]; acknowledged: string[] };
  /** Internal callers only — the commercial state before the amendment. */
  previousSnapshot?: Record<string, unknown>;
}

/** Version-conflict context (`ApiError.details` of a 409 ORDER_VERSION_CONFLICT). */
export interface VersionConflictDetails {
  currentVersion: number;
  changedBy: string | null;
  changedAt: string;
}

export interface OrderAmendmentsClient<TOrder> {
  preview: (orderId: string, changes: AmendmentChanges) => Promise<AmendmentPreview>;
  commit: (orderId: string, input: AmendmentCommitInput) => Promise<AmendmentCommitResult<TOrder>>;
  history: (orderId: string) => Promise<AmendmentHistoryRow[]>;
}

/** `base` is `/store-orders` (internal) or `/agent-portal/orders` (portal). */
export function orderAmendmentsClient<TOrder>(base: string): OrderAmendmentsClient<TOrder> {
  return {
    preview: (orderId, changes) =>
      apiClient.post<AmendmentPreview>(`${base}/${orderId}/amendments/preview`, { changes }),
    commit: (orderId, input) =>
      apiClient.post<AmendmentCommitResult<TOrder>>(`${base}/${orderId}/amendments`, input),
    history: (orderId) => apiClient.get<AmendmentHistoryRow[]>(`${base}/${orderId}/amendments`),
  };
}
