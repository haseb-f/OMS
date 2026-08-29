import type { DocumentData } from "@/types/document-engine";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { PurchaseQuotationRow } from "@/services/purchase-quotations-service";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/** Mirrors `config/sales/quotation-print.ts` — feeds the existing Print Engine's "invoice" variant, no new template. */
export function buildQuotationPrintPayload(
  quotation: PurchaseQuotationRow,
  options: {
    companyName: string;
    companyLogoUrl: string | null;
    printedByName: string | null;
    t: (key: MessageKey, params?: Record<string, string | number>) => string;
  },
): DocumentPrintPayload {
  const { companyName, companyLogoUrl, printedByName, t } = options;

  const data: DocumentData = {
    type: "purchase-order",
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
      name: quotation.partner?.name ?? "",
      taxNumber: quotation.partner?.taxNumber ?? undefined,
      addressLines: [
        quotation.partner?.address,
        quotation.partner?.city,
        quotation.partner?.country?.name,
      ].filter((value): value is string => !!value),
      phone: quotation.partner?.phone ?? undefined,
      email: quotation.partner?.email ?? undefined,
    },
    meta: [
      ...(quotation.referenceNumber
        ? [{ label: t("purchasing.quotations.fields.reference"), value: quotation.referenceNumber }]
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
    notes: quotation.supplierNotes ?? undefined,
  };

  return {
    variant: "invoice",
    title: `${t("purchasing.quotations.title")} — ${quotation.quotationNumber}`,
    printedByName,
    data,
    labels: {
      documentNumber: t("purchasing.quotations.fields.number"),
      documentDate: t("sales.editor.header.documentDate"),
      billTo: t("purchasing.suppliers.picker.selectSupplier"),
      description: t("sales.editor.grid.product"),
      quantity: t("sales.editor.grid.quantity"),
      unitPrice: t("sales.editor.grid.unitPrice"),
      lineTotal: t("sales.editor.grid.lineTotal"),
      notes: t("sales.editor.sections.notes"),
    },
  };
}
