import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import { createFinancialTransactionService } from "./financial-transactions-service";

/**
 * What can still be refunded on one posted Sales Return — computed by the
 * API (never on the frontend): the return's unrefunded credit, capped by
 * the customer's credit balance on the posted ledger.
 */
export interface RefundableReturnSummary {
  salesReturnId: string;
  returnNumber: string;
  partnerId: string;
  currencyId: string | null;
  status: string;
  grandTotal: number;
  refundedTotal: number;
  unrefundedCredit: number;
  customerCreditBalance: number;
  refundableAmount: number;
}

/** R22 D4 — a confirmed customer receipt with an unapplied part that can be paid back (`open-receipts`). */
export interface RefundableReceiptRow {
  receiptId: string;
  transactionNumber: string;
  transactionDate: string;
  currencyId: string | null;
  amount: number;
  unapplied: number;
}

const BASE_PATH = "/financial-transactions/refunds";

/**
 * Customer Refund (رد مبلغ لعميل) — the shared financial-transaction client
 * plus the two refund-specific reads. Allocation targets a Sales Return id
 * (sent as `invoiceId`, the generic allocation field) and is fixed once the
 * refund is confirmed.
 */
export const customerRefundsService = {
  ...createFinancialTransactionService(BASE_PATH),
  refundable: (salesReturnId: string) =>
    apiClient.get<RefundableReturnSummary>(`${BASE_PATH}/refundable/${salesReturnId}`),
  openReturns: (partnerId: string) =>
    apiClient.get<RefundableReturnSummary[]>(
      `${BASE_PATH}/open-returns${buildQueryString({ partnerId })}`,
    ),
  /** R22 D4 — the customer's confirmed receipts with an unapplied (advance) part. */
  openReceipts: (partnerId: string) =>
    apiClient.get<RefundableReceiptRow[]>(
      `${BASE_PATH}/open-receipts${buildQueryString({ partnerId })}`,
    ),
};
