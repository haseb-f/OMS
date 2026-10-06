import type { MessageKey } from "@/i18n/translate";
import type { StatusTone } from "@/components/business/status-badge";
import type { FinancialTransactionErrorKeys } from "@/components/financial-transactions/financial-transaction-validation";
import { financialTransactionErrorKeys } from "@/components/financial-transactions/financial-transaction-validation";
import type {
  FinancialTransactionFormPayload,
  FinancialTransactionStatusValue,
  OpenInvoiceRow,
} from "@/services/financial-transactions-service";

/**
 * Expenses screen (R13 owner decision 2) — the pure rules of the expense
 * voucher form: what must be filled to save / post, what the request body
 * is, and how the posting state reads. Kept out of the page so it is unit
 * tested (vitest) and the page only wires state to it.
 */
export interface ExpenseVoucherFormState {
  transactionDate: Date | null;
  expenseAccountId: string | null;
  description: string;
  amount: number;
  currencyId: string | null;
  receivingAccountId: string | null;
  paymentSourceId: string | null;
  partnerId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  referenceNumber: string;
  notes: string;
}

/**
 * Inline errors keyed by the shared editor's fields — the expense account
 * sits in the editor's party slot. Posting also needs the paid-from account
 * (the Posting Engine's credit side); a draft does not.
 */
export function expenseVoucherErrorKeys(
  state: Pick<ExpenseVoucherFormState, "expenseAccountId" | "amount" | "receivingAccountId">,
  forPosting: boolean,
): FinancialTransactionErrorKeys | null {
  const errors = financialTransactionErrorKeys({
    hasParty: Boolean(state.expenseAccountId),
    amount: state.amount,
    allocatedTotal: 0,
    receivingAccountId: state.receivingAccountId,
    forPosting,
  });
  if (errors?.party) errors.party = "expenseVouchers.validation.expenseAccountRequired";
  return errors;
}

const trimmed = (value: string) => {
  const text = value.trim();
  return text.length > 0 ? text : undefined;
};

/**
 * The request body. A new voucher omits empty optional links; an edit sends
 * `null` for a cleared counterparty / cost center / project so the server
 * clears it (an omitted key means "unchanged"). Never carries allocations:
 * an expense never settles an invoice.
 */
export function buildExpenseVoucherPayload(
  state: ExpenseVoucherFormState,
  mode: "create" | "update",
): FinancialTransactionFormPayload {
  const clearable = (value: string | null) => value ?? (mode === "update" ? null : undefined);
  return {
    expenseAccountId: state.expenseAccountId ?? undefined,
    transactionDate: state.transactionDate ? state.transactionDate.toISOString() : undefined,
    amount: state.amount,
    currencyId: state.currencyId ?? undefined,
    receivingAccountId: state.receivingAccountId ?? undefined,
    paymentSourceId: state.paymentSourceId ?? undefined,
    partnerId: clearable(state.partnerId),
    costCenterId: clearable(state.costCenterId),
    projectId: clearable(state.projectId),
    description: trimmed(state.description),
    referenceNumber: trimmed(state.referenceNumber),
    notes: trimmed(state.notes),
  };
}

export type ExpensePostingState = "notPosted" | "posted" | "reversed";

/** Draft = nothing posted; Confirmed = its entry is posted; Cancelled = reversed by a reversal entry. */
export function expensePostingState(status: FinancialTransactionStatusValue): ExpensePostingState {
  if (status === "CONFIRMED") return "posted";
  if (status === "CANCELLED") return "reversed";
  return "notPosted";
}

export const EXPENSE_POSTING_LABEL_KEY: Record<ExpensePostingState, MessageKey> = {
  notPosted: "expenseVouchers.posting.notPosted",
  posted: "expenseVouchers.posting.posted",
  reversed: "expenseVouchers.posting.reversed",
};

export const EXPENSE_POSTING_TONE: Record<ExpensePostingState, StatusTone> = {
  notPosted: "neutral",
  posted: "success",
  reversed: "destructive",
};

/** What the counterparty still owes on open purchase invoices — drives "Pay invoice instead". */
export function openInvoicesSummary(invoices: readonly OpenInvoiceRow[]): {
  count: number;
  remaining: number;
} {
  const remaining = invoices.reduce((sum, invoice) => sum + invoice.remainingBalance, 0);
  return { count: invoices.length, remaining: Math.round(remaining * 100) / 100 };
}

/** The supplier payment editor, prefilled with the supplier and the invoice (allocated in full). */
export function payInvoiceHref(partnerId: string, invoiceId: string): string {
  const params = new URLSearchParams({ partnerId, invoiceId });
  return `/purchasing/payments/new?${params.toString()}`;
}

export const EXPENSES_ROUTE = "/finance/expenses";

export function expenseVoucherHref(id: string): string {
  return `${EXPENSES_ROUTE}/${id}`;
}
