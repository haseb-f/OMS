import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import { createFinancialTransactionService } from "./financial-transactions-service";
import type { FinancialTransactionDirection } from "@/config/financial-transactions/transaction-type";

/**
 * R22 D4 (contract 4) — the voucher types beyond invoice settlement, on the
 * SAME FinancialTransaction service shape as receipts / payments (list / get
 * / create / createConfirmed / update / confirm / cancel). Built against the
 * shared contract; the API controllers come from stream T.
 */
export const otherReceiptsService = createFinancialTransactionService(
  "/financial-transactions/other-receipts",
);
export const otherPaymentsService = createFinancialTransactionService(
  "/financial-transactions/other-payments",
);
export const internalTransfersService = createFinancialTransactionService(
  "/financial-transactions/transfers",
);

/** One authorised counter-account (posting / leaf, not cash / bank, not AR / AP control). */
export interface CounterAccountOption {
  id: string;
  code: string;
  name: string;
  /** Chart-of-accounts type (EQUITY / LIABILITY / REVENUE / ASSET …) when the API sends it. */
  type?: string | null;
}

type CounterAccountResponse = CounterAccountOption[] | { items: CounterAccountOption[] };

const counterAccountRequests = new Map<
  FinancialTransactionDirection,
  Promise<CounterAccountOption[]>
>();

/** `GET financial-transactions/counter-accounts?direction=IN|OUT` — the allow-list (cached per session and direction). */
export const counterAccountsService = {
  list: (direction: FinancialTransactionDirection): Promise<CounterAccountOption[]> => {
    let request = counterAccountRequests.get(direction);
    if (!request) {
      request = apiClient
        .get<CounterAccountResponse>(
          `/financial-transactions/counter-accounts${buildQueryString({ direction })}`,
        )
        .then((response) => (Array.isArray(response) ? response : (response?.items ?? [])))
        .catch((error: unknown) => {
          // Retry on the next open instead of caching the failure.
          counterAccountRequests.delete(direction);
          throw error;
        });
      counterAccountRequests.set(direction, request);
    }
    return request;
  },
};
