import { apiClient } from "./api-client";

export type LookupOrderStatus = "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "RETURNED";
export type LookupLeadStatus = "OPEN" | "CONVERTED" | "CLOSED";

/** One match — the fixed, minimal shape of `POST /customer-lookup/advanced`. */
export interface AdvancedLookupMatch {
  kind: "CUSTOMER" | "LEAD";
  maskedPhone: string | null;
  partialName: string;
  reference: {
    type: "ORDER" | "LEAD";
    number: string;
    status: LookupOrderStatus | LookupLeadStatus;
  } | null;
  notAssignedToYou: boolean;
  /** Present only when the caller already has scope over that exact record. */
  openable: { type: "ORDER" | "LEAD"; id: string } | null;
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
