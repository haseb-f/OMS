import { apiClient } from "./api-client";

export type PaymentReviewStatus = "PENDING" | "MATCHED" | "VERIFIED" | "REJECTED";

export interface PaymentReviewRow {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  amount: string;
  status: PaymentReviewStatus;
  referenceNumber: string | null;
  senderName: string;
  createdAt: string;
  currency: { id: string; code: string; name: string } | null;
  paymentSource: { id: string; name: string } | null;
  receivingAccount: { id: string; name: string } | null;
  storeOrder: {
    id: string;
    internalOrderId: string;
    paymentStatus: string;
    partner: { id: string; name: string; partnerNumber: string } | null;
  } | null;
  lead: { id: string; leadNumber: string; customerName: string } | null;
  attachments: { id: string; fileName: string | null; attachmentType: string }[];
  matchedBy: { id: string; fullName: string } | null;
  verifiedBy: { id: string; fullName: string } | null;
  settlement: {
    total: number;
    paid: number;
    outstanding: number;
    fullySettled: boolean;
  } | null;
}

/** What happened to the Customer Receipt / JE after verification. */
export type PaymentCollectionResult =
  | { status: "NOT_APPLICABLE" | "PENDING_INVOICE" }
  | { status: "POSTED"; receipts: Array<{ id: string; transactionNumber: string }> }
  | { status: "FAILED"; message: string };

export interface PaymentVerifyResult {
  id: string;
  status: PaymentReviewStatus;
  collection: PaymentCollectionResult;
}

export interface PaymentReviewResult {
  items: PaymentReviewRow[];
  total: number;
  page: number;
  pageSize: number;
}

function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export const paymentsReviewService = {
  list: (params: { status?: PaymentReviewStatus; page?: number; pageSize?: number } = {}) =>
    apiClient.get<PaymentReviewResult>(`/payments${qs(params)}`),
  match: (id: string, matchedById: string) =>
    apiClient.post(`/payments/${id}/match`, { matchedById }),
  /** Idempotent — re-verifying a VERIFIED payment only retries the receipt posting. */
  verify: (id: string, verifiedById: string) =>
    apiClient.post<PaymentVerifyResult>(`/payments/${id}/verify`, { verifiedById }),
  reject: (id: string, rejectedById: string, rejectionReason?: string) =>
    apiClient.post(`/payments/${id}/reject`, { rejectedById, rejectionReason }),
};
