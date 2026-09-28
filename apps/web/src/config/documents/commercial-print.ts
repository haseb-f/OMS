import type { DocumentData, DocumentParty, DocumentType } from "@/types/document-engine";
import type { DocumentPrintPayload, DocumentPrintVariant } from "@/types/print-engine";
import { documentPrintBranding } from "@/components/print/print-brand";
import { INVOICE_PAYMENT_STATUS_LABEL_KEY } from "@/config/financial-transactions/status";
import type { PartnerRow } from "@/services/partners-service";
import type { ProductRow } from "@/services/products-service";
import type { InvoicePaymentStatusValue } from "@/services/financial-transactions-service";
import type { CurrencyRow, TaxRow, UnitRow } from "@/config/master-data/entities";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/**
 * Shared builders for the commercial-document and voucher prints (Print
 * Design System spec §3). Every sales / purchasing builder funnels through
 * here so the party block, item columns, totals, currency and payment status
 * are assembled one way. Values are the record's server values — nothing is
 * recalculated for print.
 */

export type PrintTranslate = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface PrintBuilderOptions {
  companyName: string;
  companyLogoUrl: string | null;
  printedByName: string | null;
  t: PrintTranslate;
}

/** Party block from a partner record (number, tax no., address, phone, email). */
export function partnerPrintParty(partner: PartnerRow | null | undefined): DocumentParty {
  return {
    name: partner?.name ?? "",
    number: partner?.partnerNumber || undefined,
    taxNumber: partner?.taxNumber ?? undefined,
    addressLines: [partner?.address, partner?.city, partner?.country?.name].filter(
      (value): value is string => !!value,
    ),
    phone: partner?.phone || partner?.mobile || undefined,
    email: partner?.email ?? undefined,
  };
}

/** The item-line fields every sales / purchasing document shares. */
export interface CommercialPrintLine {
  id: string;
  product?: ProductRow;
  description: string | null;
  unit?: UnitRow | null;
  quantity: number;
  unitPrice: string;
  discountPercent: string;
  discountValue: string;
  tax?: TaxRow | null;
  taxAmount: string;
  lineTotal: string;
}

export interface CommercialPrintInput {
  type: DocumentType;
  titleKey: MessageKey;
  documentNumber: string;
  /** ISO date of the document. */
  date: string;
  partner?: PartnerRow | null;
  partyRole: "customer" | "supplier";
  currency?: CurrencyRow | null;
  referenceNumber?: string | null;
  /** Source document (quotation / order / invoice number), when linked. */
  sourceNumber?: string | null;
  items: CommercialPrintLine[];
  /** Server totals; `discount` omitted when the record has no discount column. */
  totals: { subtotal: number; discount?: number; tax: number; grandTotal: number };
  /** Invoices only — server-computed (never re-derived here). */
  payment?: { status: InvoicePaymentStatusValue; paid: number; remaining: number };
  /** Customer- / supplier-facing notes only — internal notes are never printed. */
  notes?: string | null;
  recordPath: string;
}

function taxLabel(tax: TaxRow | null | undefined): string | undefined {
  if (!tax) return undefined;
  const rate = Number(tax.rate);
  return Number.isFinite(rate) ? `${tax.name} ${rate}%` : tax.name;
}

/** Invoice, quotation, order and return prints (sales and purchasing). */
export function buildCommercialPrintPayload(
  input: CommercialPrintInput,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  const { companyName, companyLogoUrl, printedByName, t } = options;
  const { totals } = input;

  const data: DocumentData = {
    type: input.type,
    documentNumber: input.documentNumber,
    documentDate: formatDate(input.date),
    currency: input.currency?.code ?? "",
    company: {
      name: companyName,
      addressLines: [],
      branding: documentPrintBranding(companyLogoUrl),
    },
    party: partnerPrintParty(input.partner),
    partyRole: input.partyRole,
    ...(input.payment
      ? {
          payment: {
            statusLabel: t(INVOICE_PAYMENT_STATUS_LABEL_KEY[input.payment.status]),
            paid: input.payment.paid,
            remaining: input.payment.remaining,
          },
        }
      : {}),
    meta: [
      ...(input.referenceNumber
        ? [{ label: t("printDocument.reference"), value: input.referenceNumber }]
        : []),
      ...(input.sourceNumber
        ? [{ label: t("printDocument.sourceDocument"), value: input.sourceNumber }]
        : []),
    ],
    lineItems: input.items.map((item) => ({
      id: item.id,
      description: item.product?.displayName || item.product?.name || item.description || "",
      sku: item.product?.sku || undefined,
      quantity: item.quantity,
      unit: item.unit?.name,
      unitPrice: Number(item.unitPrice),
      discount: Number(item.discountValue) || undefined,
      discountPercent: Number(item.discountPercent) || undefined,
      taxLabel: taxLabel(item.tax),
      taxAmount: Number(item.taxAmount) || undefined,
      total: Number(item.lineTotal),
    })),
    totals: [
      { label: t("printDocument.subtotal"), value: totals.subtotal },
      ...(totals.discount
        ? [{ label: t("printDocument.discountTotal"), value: totals.discount }]
        : []),
      ...(totals.tax ? [{ label: t("printDocument.taxTotal"), value: totals.tax }] : []),
      { label: t("printDocument.grandTotal"), value: totals.grandTotal, emphasis: true },
    ],
    notes: input.notes || undefined,
  };

  return {
    variant: "invoice",
    title: t(input.titleKey),
    printedByName,
    recordPath: input.recordPath,
    data,
  };
}

export interface VoucherPrintInput {
  type: DocumentType;
  variant: Extract<DocumentPrintVariant, "receipt" | "voucher">;
  titleKey: MessageKey;
  documentNumber: string;
  date: string;
  partner?: PartnerRow | null;
  partyRole: "customer" | "supplier";
  currency?: { code: string } | null;
  meta: { label: string; value: string }[];
  /** Documents the amount is applied to (invoice / return numbers). */
  allocations: { id: string; description: string; amount: number }[];
  amount: number;
  notes?: string | null;
  recordPath: string;
}

/** Receipt / refund / payment vouchers — party, applied-to lines, amount, signatures. */
export function buildVoucherPrintPayload(
  input: VoucherPrintInput,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  const { companyName, companyLogoUrl, printedByName, t } = options;
  const data: DocumentData = {
    type: input.type,
    documentNumber: input.documentNumber,
    documentDate: formatDate(input.date),
    currency: input.currency?.code ?? "",
    company: {
      name: companyName,
      addressLines: [],
      branding: documentPrintBranding(companyLogoUrl),
    },
    party: partnerPrintParty(input.partner),
    partyRole: input.partyRole,
    meta: input.meta,
    lineItems: input.allocations.map((allocation) => ({
      id: allocation.id,
      description: allocation.description,
      quantity: 1,
      unitPrice: allocation.amount,
      total: allocation.amount,
    })),
    totals: [{ label: t("printDocument.amount"), value: input.amount, emphasis: true }],
    notes: input.notes || undefined,
    signatures: [
      { label: t("printDocument.preparedBy") },
      { label: t("printDocument.approvedBy") },
      { label: t("printDocument.receivedBy") },
    ],
  };
  return {
    variant: input.variant,
    title: t(input.titleKey),
    printedByName,
    recordPath: input.recordPath,
    data,
  };
}
