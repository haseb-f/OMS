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
};
