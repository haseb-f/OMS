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
};
