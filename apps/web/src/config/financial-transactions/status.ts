import type { StatusTone } from "@/components/business/status-badge";
import type {
  FinancialTransactionStatusValue,
  InvoicePaymentStatusValue,
} from "@/services/financial-transactions-service";
import type { MessageKey } from "@/i18n/translate";

/** Shared by Customer Receipts and Supplier Payments — the status set itself is identical, only the entity-specific copy around it differs. */
export const TRANSACTION_STATUS_LABEL_KEY: Record<FinancialTransactionStatusValue, MessageKey> = {
  DRAFT: "financialTransactions.status.draft",
  CONFIRMED: "financialTransactions.status.confirmed",
  CANCELLED: "financialTransactions.status.cancelled",
};

export const TRANSACTION_STATUS_TONE: Record<FinancialTransactionStatusValue, StatusTone> = {
  DRAFT: "neutral",
  CONFIRMED: "success",
  CANCELLED: "destructive",
};

export function buildTransactionStatusOptions(t: (key: MessageKey) => string) {
  return (Object.keys(TRANSACTION_STATUS_LABEL_KEY) as FinancialTransactionStatusValue[]).map(
    (value) => ({
      value,
      label: t(TRANSACTION_STATUS_LABEL_KEY[value]),
      tone: TRANSACTION_STATUS_TONE[value],
    }),
  );
}

export const TRANSACTION_FILTERABLE_STATUSES: FinancialTransactionStatusValue[] = [
  "DRAFT",
  "CONFIRMED",
  "CANCELLED",
];
export const TRANSACTION_ARCHIVABLE_STATUSES: FinancialTransactionStatusValue[] = [
  "DRAFT",
  "CANCELLED",
];

export const INVOICE_PAYMENT_STATUS_LABEL_KEY: Record<InvoicePaymentStatusValue, MessageKey> = {
  UNPAID: "financialTransactions.invoiceStatus.unpaid",
  PARTIALLY_PAID: "financialTransactions.invoiceStatus.partiallyPaid",
  PAID: "financialTransactions.invoiceStatus.paid",
  CANCELLED: "financialTransactions.invoiceStatus.cancelled",
};

export const INVOICE_PAYMENT_STATUS_TONE: Record<InvoicePaymentStatusValue, StatusTone> = {
  UNPAID: "destructive",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  CANCELLED: "neutral",
};
