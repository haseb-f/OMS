import { apiClient } from "./api-client";

export type LookupOrderStatus = "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "RETURNED";
export type LookupLeadStatus = "OPEN" | "CONVERTED" | "CLOSED";

/**
 * R14 — what a `customers.lookup_advanced` holder is shown about a found
 * customer (advanced lookup and order-entry duplicate panel): full name and
 * phone, the latest company order and the company-wide order counts.
 */
export interface CustomerDisclosure {
  name: string;
  /** E.164 when known. */
  phone: string | null;
  latestOrder: {
    number: string;
    /** YYYY-MM-DD (Cairo day). */
    orderDate: string;
    productSummary: string;
    status: LookupOrderStatus;
  } | null;
  placedOrders: number;
  completedPurchases: number;
}

/** One match — the fixed shape of `POST /customer-lookup/advanced`. */
export interface AdvancedLookupMatch {
  kind: "CUSTOMER" | "LEAD";
  maskedPhone: string | null;
  partialName: string;
  reference: {
    type: "ORDER" | "LEAD";
    number: string;
    status: LookupOrderStatus | LookupLeadStatus;
  } | null;
  /** Earlier orders the caller can already open (own scope only); empty for somebody else's customer. */
  previousOrders: {
    id: string;
    number: string;
    orderDate: string;
    status: LookupOrderStatus;
  }[];
  notAssignedToYou: boolean;
  /** Present only when the caller already has scope over that exact record. */
  openable: { type: "ORDER" | "LEAD"; id: string } | null;
  /** R14 — full identity, latest order and counts. */
  disclosure: CustomerDisclosure;
}

export interface AdvancedLookupResult {
  exists: boolean;
  matches: AdvancedLookupMatch[];
  capped: boolean;
  remainingInWindow: number;
}

export const customerLookupService = {
  /** POST so the searched phone/name never appears in a URL or access log. */
  advanced: (query: string) =>
    apiClient.post<AdvancedLookupResult>("/customer-lookup/advanced", { query }),
};
