import type { MessageKey } from "@/i18n/translate";

export type FinancialTransactionTypeCode =
  "CUSTOMER_RECEIPT" | "SUPPLIER_PAYMENT" | "EXPENSE_PAYMENT";

export type FinancialTransactionDirection = "IN" | "OUT";

/**
 * Frontend mirror of the API catalog. Display copy lives in i18n; List Sheet
 * Arabic labels stay on the API catalog so Google Sheets and OMS agree.
 */
export const FINANCIAL_TRANSACTION_TYPE_CATALOG = [
  { code: "CUSTOMER_RECEIPT" as const, direction: "IN" as const },
  { code: "SUPPLIER_PAYMENT" as const, direction: "OUT" as const },
  { code: "EXPENSE_PAYMENT" as const, direction: "OUT" as const },
];

export const FINANCIAL_TRANSACTION_TYPE_LABEL_KEY: Record<
  FinancialTransactionTypeCode,
  MessageKey
> = {
  CUSTOMER_RECEIPT: "financialTransactions.types.CUSTOMER_RECEIPT",
  SUPPLIER_PAYMENT: "financialTransactions.types.SUPPLIER_PAYMENT",
  EXPENSE_PAYMENT: "financialTransactions.types.EXPENSE_PAYMENT",
};

export const FINANCIAL_TRANSACTION_DIRECTION_LABEL_KEY: Record<
  FinancialTransactionDirection,
  MessageKey
> = {
  IN: "financialTransactions.direction.in",
  OUT: "financialTransactions.direction.out",
};

export function typesForDirection(direction: FinancialTransactionDirection) {
  return FINANCIAL_TRANSACTION_TYPE_CATALOG.filter((type) => type.direction === direction);
}
