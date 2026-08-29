import type { DocumentData } from "@/types/document-engine";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { FinancialTransactionRow } from "@/services/financial-transactions-service";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/** Feeds the existing Print Engine's dedicated "receipt" variant/template — no new template built, per "reuse the Print Engine" instruction. */
export function buildReceiptPrintPayload(
  receipt: FinancialTransactionRow,
  options: {
    companyName: string;
    companyLogoUrl: string | null;
    printedByName: string | null;
    t: (key: MessageKey, params?: Record<string, string | number>) => string;
  },
): DocumentPrintPayload {
  const { companyName, companyLogoUrl, printedByName, t } = options;

  const data: DocumentData = {
    type: "receipt-voucher",
    documentNumber: receipt.transactionNumber,
    documentDate: formatDate(receipt.transactionDate),
    currency: receipt.currency?.code ?? "",
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
      name: receipt.partner?.name ?? "",
      taxNumber: receipt.partner?.taxNumber ?? undefined,
      addressLines: [
        receipt.partner?.address,
        receipt.partner?.city,
        receipt.partner?.country?.name,
      ].filter((value): value is string => !!value),
      phone: receipt.partner?.phone ?? undefined,
      email: receipt.partner?.email ?? undefined,
    },
    meta: [
      ...(receipt.referenceNumber
        ? [{ label: t("sales.receipts.fields.reference"), value: receipt.referenceNumber }]
        : []),
      ...(receipt.paymentSource
        ? [
            {
              label: t("financialTransactions.fields.paymentSource"),
              value: receipt.paymentSource.name,
            },
          ]
        : []),
    ],
    lineItems: receipt.allocations.map((allocation) => ({
      id: allocation.id,
      description: allocation.salesInvoice?.invoiceNumber ?? "",
      quantity: 1,
      unitPrice: Number(allocation.allocatedAmount),
      total: Number(allocation.allocatedAmount),
    })),
    totals: [
      {
        label: t("financialTransactions.summary.amount"),
        value: Number(receipt.amount),
        emphasis: true,
      },
    ],
    notes: receipt.notes ?? undefined,
  };

  return {
    variant: "receipt",
    title: `${t("sales.receipts.title")} — ${receipt.transactionNumber}`,
    printedByName,
    data,
    labels: {
      documentNumber: t("sales.receipts.fields.number"),
      documentDate: t("financialTransactions.fields.transactionDate"),
      billTo: t("sales.customers.picker.selectCustomer"),
      description: t("financialTransactions.allocationGrid.invoice"),
      quantity: "",
      unitPrice: "",
      lineTotal: t("financialTransactions.allocationGrid.amount"),
      notes: t("sales.editor.sections.notes"),
    },
  };
}
