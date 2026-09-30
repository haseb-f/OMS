import { apiClient, ApiError } from "./api-client";

/**
 * Round 5 Spec 1B — duplicate warning on order creation. Mirrors
 * `apps/api/src/store-orders/duplicates/duplicate-outcome.ts`.
 */

export type DuplicateDecision =
  "USE_EXISTING_CUSTOMER" | "INTENTIONAL_NEW_ORDER" | "DIFFERENT_CUSTOMER";

/** The answer sent with a create / conversion request. */
export interface DuplicateResolution {
  decision: DuplicateDecision;
  customerId?: string;
}

export interface DuplicateOrderSummary {
  id: string;
  orderNumber: string;
  orderDate: string;
  /** Not delivered / collected / returned / cancelled yet. */
  active: boolean;
  paymentStatus: string;
  declaredPaymentStatus: string;
  fulfillmentStatus: { code: string; name: string; nameEn: string | null } | null;
  total: number;
  currencyCode: string | null;
}

export interface DuplicateCustomerSummary {
  id: string;
  name: string;
  phoneMasked: string | null;
}

export interface DuplicateNameCandidate extends DuplicateCustomerSummary {
  hasOrders: boolean;
  /** Null for an own-scope user without `customers.lookup_global`. */
  orderCount: number | null;
  lastOrderDate: string | null;
}

/** A cross-scope match carries nothing but the flag. */
export type DuplicateCheckResult =
  | { kind: "NONE" }
  | { kind: "PHONE"; crossScope: true }
  | {
      kind: "PHONE";
      crossScope: false;
      customer: DuplicateCustomerSummary;
      orders: DuplicateOrderSummary[];
      otherOrdersCount: number;
    }
  | { kind: "NAME"; candidates: DuplicateNameCandidate[] };

export interface DuplicateCheckInput {
  phone?: string;
  name?: string;
  countryId?: string;
  /** Internal staff entering an agent order. */
  agentId?: string;
}

export type DuplicateReviewDecision = "CONFIRMED_DISTINCT" | "CONFIRMED_DUPLICATE";
export type DuplicateReviewStatus = "NONE" | "PENDING" | DuplicateReviewDecision;

export interface DuplicateReviewOrder {
  id: string;
  orderNumber: string;
  orderDate: string;
  createdAt: string;
  paymentStatus: string;
  fulfillmentStatus: { code: string; name: string; nameEn: string | null } | null;
  total: number;
  currencyCode: string | null;
  agent: { id: string; name: string; agentNumber: string } | null;
  owner: { id: string; fullName: string } | null;
}

export interface DuplicateReviewDetail {
  order: DuplicateReviewOrder & {
    customer: {
      id: string;
      partnerNumber: string;
      name: string;
      phone: string | null;
      mobile: string | null;
    };
    duplicateReviewStatus: DuplicateReviewStatus;
    reviewedBy: { id: string; fullName: string } | null;
    reviewedAt: string | null;
    reviewNote: string | null;
  };
  matches: Array<{
    customer: { id: string; partnerNumber: string; name: string; phone: string | null };
    orders: DuplicateReviewOrder[];
  }>;
}

export const DUPLICATE_ACKNOWLEDGEMENT_REQUIRED = "DUPLICATE_ACKNOWLEDGEMENT_REQUIRED" as const;

/** The scoped check payload a 409 `DUPLICATE_ACKNOWLEDGEMENT_REQUIRED` carries, else null. */
export function duplicateFromError(error: unknown): DuplicateCheckResult | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code !== DUPLICATE_ACKNOWLEDGEMENT_REQUIRED) return null;
  const duplicate = (error.details as { duplicate?: DuplicateCheckResult } | undefined)?.duplicate;
  return duplicate && typeof duplicate === "object" && "kind" in duplicate ? duplicate : null;
}

export const orderDuplicatesService = {
  /** Internal create dialogs (manual order, lead conversion). */
  check: (input: DuplicateCheckInput) =>
    apiClient.post<DuplicateCheckResult>("/store-orders/duplicate-check", input),
  /** Agent portal — always inside the caller's agent. */
  checkAsAgent: (input: Omit<DuplicateCheckInput, "agentId">) =>
    apiClient.post<DuplicateCheckResult>("/agent-portal/orders/duplicate-check", input),
  reviewDetail: (orderId: string) =>
    apiClient.get<DuplicateReviewDetail>(`/store-orders/${orderId}/duplicate-review`),
  resolveReview: (orderId: string, input: { decision: DuplicateReviewDecision; note?: string }) =>
    apiClient.post<DuplicateReviewDetail>(
      `/store-orders/${orderId}/duplicate-review/resolve`,
      input,
    ),
};
