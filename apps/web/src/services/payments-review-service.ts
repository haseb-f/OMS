import { apiClient } from "./api-client";

export type PaymentReviewStatus = "PENDING" | "MATCHED" | "VERIFIED" | "REJECTED" | "DISPUTED";

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
  /** Declared claims: the method whose account a confirmation debits (read-only for Finance). */
  paymentMethod: {
    id: string;
    name: string;
    requiresReconciliation: boolean;
    account: { id: string; code: string; name: string } | null;
  } | null;
  origin?: "LEGACY" | "SALES_DECLARATION" | "FINANCE_DECLARATION" | "LEAD_CONVERSION";
  declarationKind?: "FULL" | "PARTIAL" | null;
  disputeReason?: string | null;
  rejectionReason?: string | null;
  storeOrder: {
    id: string;
    internalOrderId: string;
    paymentStatus: string;
    declaredPaymentStatus?: "UNPAID" | "PARTIALLY_PAID" | "PAID";
    paymentType?: "PREPAID" | "CASH_ON_DELIVERY";
    paymentDiscrepancy?: boolean;
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

/** Result of Confirm & Post — the payment is VERIFIED and exactly one receipt + JE exist. */
export interface PaymentConfirmResult {
  id: string;
  paymentNumber: string;
  status: PaymentReviewStatus;
  /** True when a retry found the receipt already posted (nothing posted twice). */
  alreadyPosted: boolean;
  receipt: {
    id: string;
    transactionNumber: string;
    status: string;
    journalEntry: { id: string; entryNumber: string } | null;
  };
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
  /** One atomic step: validate → verify → post receipt + JE. Idempotent on retry. */
  confirm: (id: string) => apiClient.post<PaymentConfirmResult>(`/payments/${id}/confirm`),
  /** The reason is required and saved on the payment; nothing is posted. */
  reject: (id: string, rejectionReason: string) =>
    apiClient.post(`/payments/${id}/reject`, { rejectionReason }),
  /** Finance disputes a Sales declaration; flags the order if it was already fulfilled. */
  dispute: (id: string, reason: string) => apiClient.post(`/payments/${id}/dispute`, { reason }),
};
