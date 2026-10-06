import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import {
  createFinancialTransactionService,
  type FinancialTransactionListParams,
} from "./financial-transactions-service";

export * from "./financial-transactions-service";

const BASE_PATH = "/financial-transactions/expense-payments";

/** Expenses list filters — expense date range, expense account, paid-from account, counterparty. */
export interface ExpenseVoucherListParams extends FinancialTransactionListParams {
  expenseAccountId?: string | string[];
  receivingAccountId?: string | string[];
}

/** One figure per currency — reversed (cancelled) vouchers excluded. */
export interface ExpenseCurrencyTotal {
  currencyId: string | null;
  currencyCode: string | null;
  count: number;
  amount: number;
}

const base = createFinancialTransactionService(BASE_PATH);

/**
 * Expenses (R13 owner decision 2) — the expense voucher
 * (FinancialTransaction EXPENSE_PAYMENT) behind the Expenses screen. Thin
 * instantiation of the shared factory plus the list totals; an expense
 * voucher never allocates, so `allocate` / `unallocate` are not exposed.
 */
export const expenseVouchersService = {
  list: (params: ExpenseVoucherListParams = {}) => base.list(params),
  get: base.get,
  create: base.create,
  update: base.update,
  confirm: base.confirm,
  createConfirmed: base.createConfirmed,
  cancel: base.cancel,
  archive: base.archive,
  remove: base.remove,
  activities: base.activities,
  /** Open purchase invoices of the counterparty — offered as "Pay invoice instead". */
  openInvoices: base.openInvoices,
  totals: (params: ExpenseVoucherListParams = {}) =>
    apiClient.get<ExpenseCurrencyTotal[]>(
      `${BASE_PATH}/totals${buildQueryString(params as Record<string, unknown>)}`,
    ),
};
