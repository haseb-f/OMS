import { apiClient } from "./api-client";

export type PaymentReviewStatus = "PENDING" | "MATCHED" | "VERIFIED" | "REJECTED" | "DISPUTED";

export interface PaymentReviewRow {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  amount: string;
  status: PaymentReviewStatus;
  settlementStatus?: PaymentSettlementStatusValue;
  destinationOwnership?: "COMPANY" | "AGENT" | null;
  /** Statement allocations still standing (reject/dispute are refused while any exist). */
  activeMatchCount?: number;
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

/** Per-item outcome of a server bulk action — every refusal keeps the server's own reason. */
export interface BulkItemFailure {
  id: string;
  code: string;
  message: string;
}

export interface BulkItemsResult<S> {
  succeeded: S[];
  failed: BulkItemFailure[];
}

export type CurrencyTotals = Record<string, { count: number; amount: number }>;

export interface PaymentReviewStage {
  count: number;
  totals: CurrencyTotals;
  methods: { id: string; name: string; count: number }[];
}

/** `GET /payments/review-summary` — statement stages are null without reconciliation access. */
export interface PaymentReviewSummary {
  declared: PaymentReviewStage;
  /** MATCHED claims of reconciliation methods — finished in their workspace. */
  partiallyAllocated: PaymentReviewStage;
  unmatchedLines: PaymentReviewStage | null;
  exceptions: PaymentReviewStage | null;
  awaitingConfirmation: PaymentReviewStage;
  awaitingSettlement: PaymentReviewStage;
  disputed: PaymentReviewStage;
}

export type PaymentSettlementStatusValue =
  "NOT_APPLICABLE" | "AWAITING_SETTLEMENT" | "PARTIALLY_SETTLED" | "SETTLED";

/** `GET /payments/:id/review-context` — the match panel's declaration side. */
export interface PaymentReviewContext {
  id: string;
  paymentNumber: string;
  status: PaymentReviewStatus;
  settlementStatus: PaymentSettlementStatusValue;
  amount: number;
  settledAmount: number;
  matchedAmount: number;
  activeMatchCount: number;
  currency: { id: string; code: string };
  paymentDate: string;
  referenceNumber: string | null;
  senderName: string;
  origin: "LEGACY" | "SALES_DECLARATION" | "FINANCE_DECLARATION" | "LEAD_CONVERSION";
  declarationKind: "FULL" | "PARTIAL" | null;
  destinationOwnership: "COMPANY" | "AGENT" | null;
  disputeReason: string | null;
  rejectionReason: string | null;
  method: { id: string; name: string; requiresReconciliation: boolean } | null;
  paymentSource: { id: string; name: string } | null;
  debitAccount: {
    id: string;
    code: string;
    name: string;
    source: "PAYMENT_METHOD" | "RECEIVING_ACCOUNT";
  } | null;
  storeOrder: {
    id: string;
    internalOrderId: string;
    externalOrderId: string | null;
    currency: { id: string; code: string };
  } | null;
  customer: { id: string; name: string; phone: string | null; kind: "CUSTOMER" | "LEAD" } | null;
  orderSettlement: {
    total: number;
    paid: number;
    outstanding: number;
    fullySettled: boolean;
  } | null;
  attachments: {
    id: string;
    attachmentId: string | null;
    fileName: string | null;
    fileUrl: string;
    attachmentType: string;
    createdAt: string;
  }[];
  receipt: { id: string; transactionNumber: string; status: string } | null;
  journalEntry: { id: string; entryNumber: string } | null;
}

export interface BulkConfirmedPayment {
  id: string;
  paymentNumber: string;
  receiptNumber: string;
  journalEntryNumber: string | null;
}

export interface BulkRejectedPayment {
  id: string;
  paymentNumber: string;
  status: PaymentReviewStatus;
}

export type PaymentSettlementFilter = Exclude<PaymentSettlementStatusValue, "NOT_APPLICABLE">;

export const paymentsReviewService = {
  list: (
    params: {
      status?: PaymentReviewStatus;
      settlementStatus?: PaymentSettlementFilter[];
      /** "false": confirmable from review (no reconciliation method); "true": reconciliation methods only. */
      reconciled?: "true" | "false";
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    apiClient.get<PaymentReviewResult>(
      `/payments${qs({ ...params, settlementStatus: params.settlementStatus?.join(",") })}`,
    ),
  summary: () => apiClient.get<PaymentReviewSummary>("/payments/review-summary"),
  context: (id: string) => apiClient.get<PaymentReviewContext>(`/payments/${id}/review-context`),
  /** Each id through the single Confirm & Post (own transaction); refusals come back per item. */
  bulkConfirm: (ids: string[]) =>
    apiClient.post<BulkItemsResult<BulkConfirmedPayment>>("/payments/bulk/confirm", { ids }),
  /** One shared reason for every rejected declaration; refusals come back per item. */
  bulkReject: (ids: string[], rejectionReason: string) =>
    apiClient.post<BulkItemsResult<BulkRejectedPayment>>("/payments/bulk/reject", {
      ids,
      rejectionReason,
    }),
  /** One atomic step: validate → verify → post receipt + JE. Idempotent on retry. */
  confirm: (id: string) => apiClient.post<PaymentConfirmResult>(`/payments/${id}/confirm`),
  /** The reason is required and saved on the payment; nothing is posted. */
  reject: (id: string, rejectionReason: string) =>
    apiClient.post(`/payments/${id}/reject`, { rejectionReason }),
  /** Finance disputes a Sales declaration; flags the order if it was already fulfilled. */
  dispute: (id: string, reason: string) => apiClient.post(`/payments/${id}/dispute`, { reason }),
};
