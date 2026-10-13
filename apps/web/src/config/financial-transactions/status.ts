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

/** The invoice payment figures every invoice row carries (API-derived, never recomputed here). */
export interface InvoicePaymentFigures {
  paymentStatus: InvoicePaymentStatusValue;
  allocatedTotal: number;
  remainingBalance: number;
}

/**
 * R20 — the payment columns of an invoice list export: the same status label
 * and the paid / outstanding figures the screen shows (the export used to
 * leave the payment status empty).
 */
export function invoicePaymentExportFields(
  row: InvoicePaymentFigures,
  t: (key: MessageKey) => string,
): Record<"paymentStatus" | "allocatedTotal" | "remainingBalance", string> {
  return {
    paymentStatus: row.paymentStatus ? t(INVOICE_PAYMENT_STATUS_LABEL_KEY[row.paymentStatus]) : "",
    allocatedTotal: String(row.allocatedTotal ?? ""),
    remainingBalance: String(row.remainingBalance ?? ""),
  };
}

/** Document statuses of an invoice whose receivable / payable is posted — payment is then its primary state. */
const POSTED_INVOICE_STATUSES: ReadonlySet<string> = new Set([
  "CONFIRMED",
  "PARTIALLY_DELIVERED",
  "DELIVERED",
  "CLOSED",
]);

/**
 * R20 — the surface colour of an invoice record card. A posted invoice is
 * coloured by its payment status (unpaid red, partially paid amber, paid
 * green), so a confirmed-but-unpaid invoice never reads as settled; before
 * posting (draft, pending, approved) and when cancelled, the document status
 * tone stays. Both badges are still shown separately.
 */
export function invoiceSurfaceTone(
  documentStatus: string,
  documentTone: StatusTone,
  paymentStatus: InvoicePaymentStatusValue | null | undefined,
): StatusTone {
  if (!paymentStatus || !POSTED_INVOICE_STATUSES.has(documentStatus)) return documentTone;
  return INVOICE_PAYMENT_STATUS_TONE[paymentStatus];
}
