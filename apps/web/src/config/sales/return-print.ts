import type { DocumentData } from "@/types/document-engine";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { SalesReturnRow } from "@/services/sales-returns-service";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

export function buildReturnPrintPayload(
  salesReturn: SalesReturnRow,
  options: {
    companyName: string;
    companyLogoUrl: string | null;
    printedByName: string | null;
    t: (key: MessageKey, params?: Record<string, string | number>) => string;
  },
): DocumentPrintPayload {
  const { companyName, companyLogoUrl, printedByName, t } = options;

  const data: DocumentData = {
    type: "sales-return",
    documentNumber: salesReturn.returnNumber,
    documentDate: formatDate(salesReturn.createdAt),
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
      name: salesReturn.partner?.name ?? "",
      taxNumber: salesReturn.partner?.taxNumber ?? undefined,
      addressLines: [
        salesReturn.partner?.address,
        salesReturn.partner?.city,
        salesReturn.partner?.country?.name,
      ].filter((value): value is string => !!value),
      phone: salesReturn.partner?.phone ?? undefined,
      email: salesReturn.partner?.email ?? undefined,
    },
    meta: [
      ...(salesReturn.referenceNumber
        ? [{ label: t("sales.returns.fields.reference"), value: salesReturn.referenceNumber }]
        : []),
    ],
    lineItems: salesReturn.items.map((item) => ({
      id: item.id,
      description: item.product?.displayName || item.product?.name || item.description || "",
      quantity: item.quantity,
      unit: item.unit?.name,
      unitPrice: Number(item.unitPrice),
      total: Number(item.lineTotal),
    })),
    totals: [
      { label: t("sales.editor.totals.subtotal"), value: Number(salesReturn.subtotal) },
      { label: t("sales.editor.totals.discount"), value: Number(salesReturn.discountTotal) },
      { label: t("sales.editor.totals.tax"), value: Number(salesReturn.taxTotal) },
      {
        label: t("sales.editor.totals.grandTotal"),
        value: Number(salesReturn.grandTotal),
        emphasis: true,
      },
    ],
    notes: salesReturn.customerNotes ?? undefined,
  };

  return {
    variant: "invoice",
    title: `${t("sales.returns.title")} — ${salesReturn.returnNumber}`,
    printedByName,
    data,
    labels: {
      documentNumber: t("sales.returns.fields.number"),
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
