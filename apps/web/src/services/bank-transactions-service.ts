import { apiClient } from "./api-client";

export type BankTransactionMatchStatus = "UNMATCHED" | "POTENTIAL" | "MATCHED" | "DUPLICATE";

export interface BankTransactionMatchCandidate {
  paymentId: string;
  paymentNumber: string;
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
  matchStatus: BankTransactionMatchStatus;
  matchCandidates: BankTransactionMatchCandidate[] | null;
  matchedPaymentId: string | null;
  matchedPayment: { id: string; paymentNumber: string; amount: string } | null;
  matchedAt: string | null;
  matchedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface BankTransactionListParams {
  matchStatus?: BankTransactionMatchStatus;
  search?: string;
  page?: number;
  pageSize?: number;
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
  statusCounts: () =>
    apiClient.get<Record<BankTransactionMatchStatus, number>>("/bank-transactions/status-counts"),
  get: (id: string) => apiClient.get<BankTransactionRow>(`/bank-transactions/${id}`),
  runMatching: () =>
    apiClient.post<{ classified: number; byStatus: Record<string, number> }>(
      "/bank-transactions/run-matching",
    ),
  confirmMatch: (id: string, paymentId: string) =>
    apiClient.post<BankTransactionRow>(`/bank-transactions/${id}/confirm-match`, { paymentId }),
};
