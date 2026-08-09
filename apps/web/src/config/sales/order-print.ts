import type { DocumentData } from "@/types/document-engine";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { SalesOrderRow } from "@/services/sales-orders-service";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

export function buildOrderPrintPayload(
  order: SalesOrderRow,
  options: {
    companyName: string;
    companyLogoUrl: string | null;
    printedByName: string | null;
    t: (key: MessageKey, params?: Record<string, string | number>) => string;
  },
): DocumentPrintPayload {
  const { companyName, companyLogoUrl, printedByName, t } = options;

  const data: DocumentData = {
    type: "sales-order",
    documentNumber: order.orderNumber,
    documentDate: formatDate(order.createdAt),
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
      name: order.customer?.name ?? "",
      taxNumber: order.customer?.taxNumber ?? undefined,
      addressLines: [
        order.customer?.address,
        order.customer?.city,
        order.customer?.country?.name,
      ].filter((value): value is string => !!value),
      phone: order.customer?.phone ?? undefined,
      email: order.customer?.email ?? undefined,
    },
    meta: [
      ...(order.referenceNumber
        ? [{ label: t("sales.orders.fields.reference"), value: order.referenceNumber }]
        : []),
    ],
    lineItems: order.items.map((item) => ({
      id: item.id,
      description: item.product?.displayName || item.product?.name || item.description || "",
      quantity: item.quantity,
      unit: item.unit?.name,
      unitPrice: Number(item.unitPrice),
      total: Number(item.lineTotal),
    })),
    totals: [
      { label: t("sales.editor.totals.subtotal"), value: Number(order.subtotal) },
      { label: t("sales.editor.totals.discount"), value: Number(order.discountTotal) },
      { label: t("sales.editor.totals.tax"), value: Number(order.taxTotal) },
      {
        label: t("sales.editor.totals.grandTotal"),
        value: Number(order.grandTotal),
        emphasis: true,
      },
    ],
    notes: order.customerNotes ?? undefined,
  };

  return {
    variant: "invoice",
    title: `${t("sales.orders.title")} — ${order.orderNumber}`,
    printedByName,
    data,
    labels: {
      documentNumber: t("sales.orders.fields.number"),
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
