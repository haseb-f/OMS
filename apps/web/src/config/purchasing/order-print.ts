import type { DocumentData } from "@/types/document-engine";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { PurchaseOrderRow } from "@/services/purchase-orders-service";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/** Mirrors `config/sales/quotation-print.ts` — feeds the existing Print Engine's "invoice" variant, no new template. Totals are derived by summing each item's subtotal/taxAmount/lineTotal (PurchaseOrder stores no aggregate columns of its own, ADR-0015). */
export function buildOrderPrintPayload(
  order: PurchaseOrderRow,
  options: {
    companyName: string;
    companyLogoUrl: string | null;
    printedByName: string | null;
    t: (key: MessageKey, params?: Record<string, string | number>) => string;
  },
): DocumentPrintPayload {
  const { companyName, companyLogoUrl, printedByName, t } = options;
  const subtotal = order.items.reduce((sum, item) => sum + Number(item.subtotal), 0);
  const taxTotal = order.items.reduce((sum, item) => sum + Number(item.taxAmount), 0);
  const grandTotal = subtotal + taxTotal;

  const data: DocumentData = {
    type: "purchase-order",
    documentNumber: order.poNumber,
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
      name: order.partner?.name ?? "",
      taxNumber: order.partner?.taxNumber ?? undefined,
      addressLines: [
        order.partner?.address,
        order.partner?.city,
        order.partner?.country?.name,
      ].filter((value): value is string => !!value),
      phone: order.partner?.phone ?? undefined,
      email: order.partner?.email ?? undefined,
    },
    meta: [
      ...(order.referenceNumber
        ? [{ label: t("purchasing.orders.fields.reference"), value: order.referenceNumber }]
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
      { label: t("sales.editor.totals.subtotal"), value: subtotal },
      ...(taxTotal > 0 ? [{ label: t("sales.editor.totals.tax"), value: taxTotal }] : []),
      { label: t("sales.editor.totals.grandTotal"), value: grandTotal, emphasis: true },
    ],
    notes: order.supplierNotes ?? undefined,
  };

  return {
    variant: "invoice",
    title: `${t("purchasing.orders.title")} — ${order.poNumber}`,
    printedByName,
    data,
    labels: {
      documentNumber: t("purchasing.orders.fields.number"),
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
