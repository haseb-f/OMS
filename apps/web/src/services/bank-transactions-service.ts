import { apiClient } from "./api-client";

export type BankTransactionMatchStatus =
  | "UNMATCHED"
  | "POTENTIAL"
  | "PARTIALLY_MATCHED"
  | "MATCHED"
  | "DUPLICATE"
  | "CONFLICT"
  | "MANUAL_REVIEW";

export type CashFlowDirection = "INCOMING" | "OUTGOING";
export type CashFlowOutgoingType = "SUPPLIER_PAYMENT" | "EXPENSE";

export interface BankTransactionMatchCandidate {
  kind: "PAYMENT" | "STORE_ORDER" | "SALES_INVOICE" | "PURCHASE_INVOICE";
  id: string;
  label: string;
  amount: number;
  score: number;
  reasons: string[];
}

export interface BankTransactionRow {
  id: string;
  transactionId: string | null;
  transactionDate: string;
  valueDate: string | null;
  account: string | null;
  reference: string | null;
  description: string | null;
  debit: string | null;
  credit: string | null;
  amount: string;
  currencyId: string | null;
  currency: { id: string; code: string } | null;
  balance: string | null;
  bankName: string | null;
  branch: string | null;
  notes: string | null;
  direction: CashFlowDirection | null;
  cashSourceId: string | null;
  cashSource: { id: string; name: string; code: string } | null;
  outgoingType: CashFlowOutgoingType | null;
  expenseAccountId: string | null;
  expenseAccount: { id: string; code: string; name: string } | null;
  partnerId: string | null;
  partner: { id: string; name: string; partnerNumber: string } | null;
  costCenterId: string | null;
  costCenter: { id: string; code: string; name: string } | null;
  projectId: string | null;
  project: { id: string; code: string; name: string } | null;
  matchStatus: BankTransactionMatchStatus;
  matchCandidates: BankTransactionMatchCandidate[] | null;
  conflictReason: string | null;
  matchedPaymentId: string | null;
  matchedPayment: { id: string; paymentNumber: string; amount: string } | null;
  matchedFinancialTransactionId: string | null;
  matchedFinancialTransaction: {
    id: string;
    transactionNumber: string;
    amount: string;
    type: string;
  } | null;
  matchedAt: string | null;
  matchedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface BankTransactionListParams {
  matchStatus?: BankTransactionMatchStatus;
  direction?: CashFlowDirection;
  outgoingType?: CashFlowOutgoingType;
  cashSourceId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CashFlowSummary {
  incoming: {
    total: number;
    matched: number;
    partiallyMatched: number;
    unmatched: number;
    conflicts: number;
    storeOrderMatches: number;
    b2bSalesInvoiceMatches: number;
  };
  outgoing: {
    total: number;
    supplierPayments: number;
    expenses: number;
    unclassified: number;
    pendingVoucher: number;
    posted: number;
    conflicts: number;
  };
}

export interface BulkCashFlowResult {
  id: string;
  success: boolean;
  message?: string;
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const bankTransactionsService = {
  list: (params: BankTransactionListParams = {}) =>
    apiClient.get<{
      items: BankTransactionRow[];
      total: number;
      page: number;
      pageSize: number;
    }>(
      `/bank-transactions${buildQueryString(params as Record<string, string | number | undefined>)}`,
    ),
  statusCounts: (direction?: CashFlowDirection) =>
    apiClient.get<Record<BankTransactionMatchStatus, number>>(
      `/bank-transactions/status-counts${direction ? `?direction=${direction}` : ""}`,
    ),
  cashFlowSummary: () => apiClient.get<CashFlowSummary>("/bank-transactions/cash-flow-summary"),
  get: (id: string) => apiClient.get<BankTransactionRow>(`/bank-transactions/${id}`),
  runMatching: () =>
    apiClient.post<{ classified: number; byStatus: Record<string, number> }>(
      "/bank-transactions/run-matching",
    ),
  /** Legacy COD Payment match — unchanged. */
  confirmMatch: (id: string, paymentId: string) =>
    apiClient.post<BankTransactionRow>(`/bank-transactions/${id}/confirm-match`, { paymentId }),

  // --- Incoming ---
  suggestIncoming: (id: string) =>
    apiClient.post<{
      status: BankTransactionMatchStatus;
      candidates: BankTransactionMatchCandidate[];
    }>(`/bank-transactions/${id}/suggest-incoming`),
  confirmStoreOrderPayment: (
    id: string,
    dto: {
      storeOrderId: string;
      paymentSourceId: string;
      referenceNumber?: string;
      senderName?: string;
    },
  ) =>
    apiClient.post<BankTransactionRow>(`/bank-transactions/${id}/confirm-store-order-payment`, dto),
  /** Controlled Unreconcile — keeps Cash Transaction; reverses payment allocation. */
  unreconcile: (id: string, reason?: string) =>
    apiClient.post<BankTransactionRow>(`/bank-transactions/${id}/unreconcile`, {
      reason,
    }),
  confirmSalesInvoiceReceipt: (
    id: string,
    dto: {
      allocations: { invoiceId: string; allocatedAmount: number }[];
      paymentSourceId?: string;
    },
  ) =>
    apiClient.post<BankTransactionRow>(
      `/bank-transactions/${id}/confirm-sales-invoice-receipt`,
      dto,
    ),

  // --- Outgoing ---
  classifyOutgoing: (
    id: string,
    dto: {
      outgoingType: CashFlowOutgoingType;
      expenseAccountId?: string;
      partnerId?: string;
      costCenterId?: string;
      projectId?: string;
    },
  ) => apiClient.post<BankTransactionRow>(`/bank-transactions/${id}/classify-outgoing`, dto),
  suggestOutgoing: (id: string) =>
    apiClient.post<{
      status: BankTransactionMatchStatus;
      candidates: BankTransactionMatchCandidate[];
    }>(`/bank-transactions/${id}/suggest-outgoing`),
  confirmPurchaseInvoicePayment: (
    id: string,
    dto: {
      allocations: { invoiceId: string; allocatedAmount: number }[];
      paymentSourceId?: string;
    },
  ) =>
    apiClient.post<BankTransactionRow>(
      `/bank-transactions/${id}/confirm-purchase-invoice-payment`,
      dto,
    ),
  confirmExpenseVoucher: (
    id: string,
    dto: {
      expenseAccountId?: string;
      costCenterId?: string;
      projectId?: string;
      paymentSourceId?: string;
    },
  ) => apiClient.post<BankTransactionRow>(`/bank-transactions/${id}/confirm-expense-voucher`, dto),

  // --- Bulk ---
  bulkConfirmExpenseVouchers: (ids: string[]) =>
    apiClient.post<BulkCashFlowResult[]>("/bank-transactions/bulk/confirm-expense-vouchers", {
      ids,
    }),
  bulkClassifyOutgoing: (
    ids: string[],
    dto: {
      outgoingType: CashFlowOutgoingType;
      expenseAccountId?: string;
      partnerId?: string;
    },
  ) =>
    apiClient.post<BulkCashFlowResult[]>("/bank-transactions/bulk/classify-outgoing", {
      ids,
      ...dto,
    }),
};
