import type { MessageKey } from "@/i18n/translate";
import type { TraceKind } from "@/services/traceability-service";
import { cachedLookup } from "@/lib/lookup-cache";
import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import { journalEntriesService } from "@/services/journal-entries-service";
import { salesQuotationsService } from "@/services/sales-quotations-service";
import { salesOrdersService } from "@/services/sales-orders-service";
import { salesInvoicesService } from "@/services/sales-invoices-service";
import { salesReturnsService } from "@/services/sales-returns-service";
import { purchaseQuotationsService } from "@/services/purchase-quotations-service";
import { purchaseOrdersService } from "@/services/purchase-orders-service";
import { purchaseInvoicesService } from "@/services/purchase-invoices-service";
import { purchaseReturnsService } from "@/services/purchase-returns-service";
import { customerReceiptsService } from "@/services/customer-receipts-service";
import { customerRefundsService } from "@/services/customer-refunds-service";
import { supplierPaymentsService } from "@/services/supplier-payments-service";
import { storeOrdersService } from "@/services/store-orders-service";
import { landedCostService } from "@/services/landed-cost-service";
import type { FinancialTransactionRow } from "@/services/financial-transactions-service";

export interface RecordPreviewField {
  labelKey: MessageKey;
  value: string;
  /** Numbers, dates and references render LTR inside RTL text. */
  ltr?: boolean;
}

export interface RecordPreviewJournalLine {
  id: string;
  account: string;
  description: string | null;
  debit: number;
  credit: number;
}

export interface RecordPreview {
  number: string;
  status: string | null;
  fields: RecordPreviewField[];
  journal?: { lines: RecordPreviewJournalLine[]; totalDebit: number; totalCredit: number };
}

/** Structural shape shared by every commercial document row. */
interface CommercialDocLike {
  status: string;
  partner?: { name: string } | null;
  currency?: { code: string } | null;
  grandTotal?: string | number;
  documentDate?: string;
  createdAt: string;
  referenceNumber?: string | null;
  items?: unknown[];
  remainingBalance?: number;
  allocatedTotal?: number;
}

function commercialPreview(number: string, doc: CommercialDocLike): RecordPreview {
  const code = doc.currency?.code;
  const fields: RecordPreviewField[] = [
    { labelKey: "docFlow.preview.party", value: doc.partner?.name ?? "—" },
    {
      labelKey: "docFlow.preview.date",
      value: formatDate(doc.documentDate ?? doc.createdAt),
      ltr: true,
    },
  ];
  if (doc.grandTotal !== undefined) {
    fields.push({
      labelKey: "docFlow.preview.total",
      value: formatMoney(doc.grandTotal, code),
      ltr: true,
    });
  }
  if (doc.allocatedTotal !== undefined) {
    fields.push({
      labelKey: "docFlow.preview.paid",
      value: formatMoney(doc.allocatedTotal, code),
      ltr: true,
    });
  }
  if (doc.remainingBalance !== undefined) {
    fields.push({
      labelKey: "docFlow.preview.outstanding",
      value: formatMoney(doc.remainingBalance, code),
      ltr: true,
    });
  }
  if (doc.items) {
    fields.push({ labelKey: "docFlow.preview.lines", value: String(doc.items.length), ltr: true });
  }
  if (doc.referenceNumber) {
    fields.push({ labelKey: "docFlow.preview.reference", value: doc.referenceNumber, ltr: true });
  }
  return { number, status: doc.status, fields };
}

function transactionPreview(row: FinancialTransactionRow): RecordPreview {
  const code = row.currency?.code;
  const invoices = row.allocations
    .map(
      (allocation) =>
        allocation.salesInvoice?.invoiceNumber ??
        allocation.purchaseInvoice?.invoiceNumber ??
        allocation.salesReturn?.returnNumber,
    )
    .filter(Boolean)
    .join(", ");
  const fields: RecordPreviewField[] = [
    { labelKey: "docFlow.preview.party", value: row.partner?.name ?? "—" },
    { labelKey: "docFlow.preview.date", value: formatDate(row.transactionDate), ltr: true },
    { labelKey: "docFlow.preview.amount", value: formatMoney(row.amount, code), ltr: true },
    { labelKey: "docFlow.preview.allocatedTo", value: invoices || "—", ltr: Boolean(invoices) },
  ];
  if (row.paymentSource?.name) {
    fields.push({ labelKey: "docFlow.preview.paymentSource", value: row.paymentSource.name });
  }
  if (row.referenceNumber) {
    fields.push({ labelKey: "docFlow.preview.reference", value: row.referenceNumber, ltr: true });
  }
  return { number: row.transactionNumber, status: row.status, fields };
}

type PreviewFetcher = (id: string) => Promise<RecordPreview>;

/**
 * Record kind → compact preview loader, built on each module's existing
 * detail endpoint. Kinds without an entry have no detail endpoint of their
 * own; the preview shows their related records instead.
 */
const PREVIEW_FETCHERS: Partial<Record<TraceKind, PreviewFetcher>> = {
  SALES_QUOTATION: async (id) => {
    const row = await salesQuotationsService.get(id);
    return commercialPreview(row.quotationNumber, row);
  },
  SALES_ORDER: async (id) => {
    const row = await salesOrdersService.get(id);
    return commercialPreview(row.orderNumber, row);
  },
  SALES_INVOICE: async (id) => {
    const row = await salesInvoicesService.get(id);
    return commercialPreview(row.invoiceNumber, row);
  },
  SALES_RETURN: async (id) => {
    const row = await salesReturnsService.get(id);
    return commercialPreview(row.returnNumber, row);
  },
  PURCHASE_QUOTATION: async (id) => {
    const row = await purchaseQuotationsService.get(id);
    return commercialPreview(row.quotationNumber, row);
  },
  PURCHASE_ORDER: async (id) => {
    const row = await purchaseOrdersService.get(id);
    return commercialPreview(row.poNumber, row);
  },
  PURCHASE_INVOICE: async (id) => {
    const row = await purchaseInvoicesService.get(id);
    return commercialPreview(row.invoiceNumber, row);
  },
  PURCHASE_RETURN: async (id) => {
    const row = await purchaseReturnsService.get(id);
    return commercialPreview(row.returnNumber, row);
  },
  CUSTOMER_RECEIPT: async (id) => transactionPreview(await customerReceiptsService.get(id)),
  CUSTOMER_REFUND: async (id) => transactionPreview(await customerRefundsService.get(id)),
  SUPPLIER_PAYMENT: async (id) => transactionPreview(await supplierPaymentsService.get(id)),
  STORE_ORDER: async (id) => {
    const row = await storeOrdersService.get(id);
    return {
      number: row.internalOrderId,
      status: row.paymentStatus,
      fields: [
        { labelKey: "docFlow.preview.party", value: row.partner?.name ?? "—" },
        { labelKey: "docFlow.preview.date", value: formatDate(row.orderDate), ltr: true },
        ...(row.total !== undefined
          ? [
              {
                labelKey: "docFlow.preview.total" as const,
                value: formatMoney(row.total, row.currency?.code),
                ltr: true,
              },
            ]
          : []),
        { labelKey: "docFlow.preview.lines", value: String(row.items.length), ltr: true },
      ],
    };
  },
  LANDED_COST: async (id) => {
    const row = await landedCostService.get(id);
    return {
      number: row.documentNumber,
      status: row.status,
      fields: [
        { labelKey: "docFlow.preview.date", value: formatDate(row.documentDate), ltr: true },
        ...(row.referenceNumber
          ? [
              {
                labelKey: "docFlow.preview.reference" as const,
                value: row.referenceNumber,
                ltr: true,
              },
            ]
          : []),
      ],
    };
  },
  JOURNAL_ENTRY: async (id) => {
    const row = await journalEntriesService.get(id);
    const lines = [...row.lines]
      .sort((a, b) => a.lineOrder - b.lineOrder)
      .map((line) => ({
        id: line.id,
        account: line.account ? `${line.account.code} · ${line.account.name}` : line.accountId,
        description: line.description,
        debit: Number(line.debit),
        credit: Number(line.credit),
      }));
    const fields: RecordPreviewField[] = [
      { labelKey: "docFlow.preview.date", value: formatDate(row.entryDate), ltr: true },
    ];
    if (row.journal?.name)
      fields.push({ labelKey: "docFlow.preview.journal", value: row.journal.name });
    if (row.currency?.code) {
      fields.push({ labelKey: "docFlow.preview.currency", value: row.currency.code, ltr: true });
    }
    if (row.referenceNumber) {
      fields.push({ labelKey: "docFlow.preview.reference", value: row.referenceNumber, ltr: true });
    }
    if (row.description)
      fields.push({ labelKey: "docFlow.preview.description", value: row.description });
    return {
      number: row.entryNumber,
      status: row.status,
      fields,
      journal: {
        lines,
        totalDebit: Number(row.totalDebit),
        totalCredit: Number(row.totalCredit),
      },
    };
  },
};

export function hasRecordPreview(kind: TraceKind): boolean {
  return kind in PREVIEW_FETCHERS;
}

/** Fetched on demand; concurrent/repeat opens share one request for 30s. */
export function loadRecordPreview(kind: TraceKind, id: string): Promise<RecordPreview> | null {
  const fetcher = PREVIEW_FETCHERS[kind];
  if (!fetcher) return null;
  return cachedLookup(`record-preview:${kind}:${id}`, () => fetcher(id), 30_000);
}
