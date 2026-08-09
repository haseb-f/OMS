import type { DocumentData } from "@/types/document-engine";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { SalesQuotationRow } from "@/services/sales-quotations-service";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/**
 * TASK-040 — the Quotation `SalesDocumentPrintPayloadBuilder` implementation
 * (the interface itself was defined in TASK-039). Feeds the existing Print
 * Engine's "invoice" variant — no new template, per this task's "reuse the
 * shared Print Engine" instruction. Real quotation data only: company
 * branding from the active company, party from the real selected customer,
 * line items and totals straight from the server-computed record.
 */
export function buildQuotationPrintPayload(
  quotation: SalesQuotationRow,
  options: {
    companyName: string;
    companyLogoUrl: string | null;
    printedByName: string | null;
    t: (key: MessageKey, params?: Record<string, string | number>) => string;
  },
): DocumentPrintPayload {
  const { companyName, companyLogoUrl, printedByName, t } = options;

  const data: DocumentData = {
    type: "quotation",
    documentNumber: quotation.quotationNumber,
    documentDate: formatDate(quotation.documentDate),
    currency: "",
    company: {
      name: companyName,
      addressLines: [],
      branding: {
        logoUrl: companyLogoUrl,
        primaryColor: "#0F8A5F",
        secondaryColor: "#2563EB",
        paperSize: "a4-portrait",
        language: "rtl",
      },
    },
    party: {
      name: quotation.customer?.name ?? "",
      taxNumber: quotation.customer?.taxNumber ?? undefined,
      addressLines: [
        quotation.customer?.address,
        quotation.customer?.city,
        quotation.customer?.country?.name,
      ].filter((value): value is string => !!value),
      phone: quotation.customer?.phone ?? undefined,
      email: quotation.customer?.email ?? undefined,
    },
    meta: [
      ...(quotation.referenceNumber
        ? [{ label: t("sales.quotations.fields.reference"), value: quotation.referenceNumber }]
        : []),
    ],
    lineItems: quotation.items.map((item) => ({
      id: item.id,
      description: item.product?.displayName || item.product?.name || item.description || "",
      quantity: item.quantity,
      unit: item.unit?.name,
      unitPrice: Number(item.unitPrice),
      total: Number(item.lineTotal),
    })),
    totals: [
      { label: t("sales.editor.totals.subtotal"), value: Number(quotation.subtotal) },
      { label: t("sales.editor.totals.discount"), value: Number(quotation.discountTotal) },
      { label: t("sales.editor.totals.tax"), value: Number(quotation.taxTotal) },
      {
        label: t("sales.editor.totals.grandTotal"),
        value: Number(quotation.grandTotal),
        emphasis: true,
      },
    ],
    notes: quotation.customerNotes ?? undefined,
  };

  return {
    variant: "invoice",
    title: `${t("sales.quotations.title")} — ${quotation.quotationNumber}`,
    printedByName,
    data,
    labels: {
      documentNumber: t("sales.quotations.fields.number"),
      documentDate: t("sales.editor.header.documentDate"),
      billTo: t("sales.customers.picker.selectCustomer"),
      description: t("sales.editor.grid.product"),
      quantity: t("sales.editor.grid.quantity"),
      unitPrice: t("sales.editor.grid.unitPrice"),
      lineTotal: t("sales.editor.grid.lineTotal"),
      notes: t("sales.editor.sections.notes"),
    },
  };
}
