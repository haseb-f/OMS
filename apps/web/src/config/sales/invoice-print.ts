import type { DocumentData } from "@/types/document-engine";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { SalesInvoiceRow } from "@/services/sales-invoices-service";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

export function buildInvoicePrintPayload(
  invoice: SalesInvoiceRow,
  options: {
    companyName: string;
    companyLogoUrl: string | null;
    printedByName: string | null;
    t: (key: MessageKey, params?: Record<string, string | number>) => string;
  },
): DocumentPrintPayload {
  const { companyName, companyLogoUrl, printedByName, t } = options;

  const data: DocumentData = {
    type: "tax-invoice",
    documentNumber: invoice.invoiceNumber,
    documentDate: formatDate(invoice.createdAt),
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
      name: invoice.partner?.name ?? "",
      taxNumber: invoice.partner?.taxNumber ?? undefined,
      addressLines: [
        invoice.partner?.address,
        invoice.partner?.city,
        invoice.partner?.country?.name,
      ].filter((value): value is string => !!value),
      phone: invoice.partner?.phone ?? undefined,
      email: invoice.partner?.email ?? undefined,
    },
    meta: [
      ...(invoice.referenceNumber
        ? [{ label: t("sales.invoices.fields.reference"), value: invoice.referenceNumber }]
        : []),
    ],
    lineItems: invoice.items.map((item) => ({
      id: item.id,
      description: item.product?.displayName || item.product?.name || item.description || "",
      quantity: item.quantity,
      unit: item.unit?.name,
      unitPrice: Number(item.unitPrice),
      total: Number(item.lineTotal),
    })),
    totals: [
      { label: t("sales.editor.totals.subtotal"), value: Number(invoice.subtotal) },
      { label: t("sales.editor.totals.discount"), value: Number(invoice.discountTotal) },
      { label: t("sales.editor.totals.tax"), value: Number(invoice.taxTotal) },
      {
        label: t("sales.editor.totals.grandTotal"),
        value: Number(invoice.grandTotal),
        emphasis: true,
      },
    ],
    notes: invoice.customerNotes ?? undefined,
  };

  return {
    variant: "invoice",
    title: `${t("sales.invoices.title")} — ${invoice.invoiceNumber}`,
    printedByName,
    data,
    labels: {
      documentNumber: t("sales.invoices.fields.number"),
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
