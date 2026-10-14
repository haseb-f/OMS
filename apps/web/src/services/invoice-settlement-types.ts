import type {
  FinancialTransactionStatusValue,
  InvoicePaymentStatusValue,
} from "./financial-transactions-service";

/**
 * R22 contract 1 — one invoice's settlement figures, the same on sales and
 * purchase invoices (list / detail / export / open-invoices): cash paid by
 * confirmed vouchers, credit notes applied apart from cash, what remains,
 * and the derived status. Always API-derived; never recomputed here.
 */
export interface InvoiceSettlementSummary {
  grandTotal: number;
  paidTotal: number;
  creditedTotal: number;
  remainingBalance: number;
  paymentStatus: InvoicePaymentStatusValue;
  currencyCode: string | null;
}

/** R22 contract 2 — one line of an invoice's settlement history (permission-scoped by the API). */
export interface InvoiceSettlementEntry {
  kind: "PAYMENT" | "CREDIT_NOTE";
  documentId: string;
  documentNumber: string;
  /** CUSTOMER_RECEIPT / SUPPLIER_PAYMENT for a payment; the return's type for a credit note. */
  documentType: string;
  date: string | null;
  status: FinancialTransactionStatusValue | string;
  amount: number;
  currencyCode: string | null;
  allocationId?: string | null;
  canUnallocate: boolean;
  canCancel: boolean;
}

/** `GET /sales|purchasing/invoices/:id/settlement`. */
export interface InvoiceSettlement {
  summary: InvoiceSettlementSummary;
  entries: InvoiceSettlementEntry[];
}
