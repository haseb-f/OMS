import type { DocumentData } from "@/types/document-engine";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { PurchaseReturnRow } from "@/services/purchase-returns-service";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/** Mirrors `config/sales/quotation-print.ts` — feeds the existing Print Engine's "invoice" variant. */
export function buildReturnPrintPayload(
  purchaseReturn: PurchaseReturnRow,
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
    documentNumber: purchaseReturn.returnNumber,
    documentDate: formatDate(purchaseReturn.createdAt),
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
      name: purchaseReturn.partner?.name ?? "",
      taxNumber: purchaseReturn.partner?.taxNumber ?? undefined,
      addressLines: [
        purchaseReturn.partner?.address,
        purchaseReturn.partner?.city,
        purchaseReturn.partner?.country?.name,
      ].filter((value): value is string => !!value),
      phone: purchaseReturn.partner?.phone ?? undefined,
      email: purchaseReturn.partner?.email ?? undefined,
    },
    meta: [
      ...(purchaseReturn.referenceNumber
        ? [
            {
              label: t("purchasing.returns.fields.reference"),
              value: purchaseReturn.referenceNumber,
            },
          ]
        : []),
    ],
    lineItems: purchaseReturn.items.map((item) => ({
      id: item.id,
      description: item.product?.displayName || item.product?.name || item.description || "",
      quantity: item.quantity,
      unit: item.unit?.name,
      unitPrice: Number(item.unitPrice),
      total: Number(item.lineTotal),
    })),
    totals: [
      { label: t("sales.editor.totals.subtotal"), value: Number(purchaseReturn.subtotal) },
      { label: t("sales.editor.totals.discount"), value: Number(purchaseReturn.discountTotal) },
      { label: t("sales.editor.totals.tax"), value: Number(purchaseReturn.taxTotal) },
      {
        label: t("sales.editor.totals.grandTotal"),
        value: Number(purchaseReturn.grandTotal),
        emphasis: true,
      },
    ],
    notes: purchaseReturn.supplierNotes ?? undefined,
  };

  return {
    variant: "invoice",
    title: `${t("purchasing.returns.title")} — ${purchaseReturn.returnNumber}`,
    printedByName,
    data,
    labels: {
      documentNumber: t("purchasing.returns.fields.number"),
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
