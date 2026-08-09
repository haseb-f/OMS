import type { DocumentData } from "@/types/document-engine";
import type { DocumentPrintPayload } from "@/types/print-engine";
import type { FinancialTransactionRow } from "@/services/financial-transactions-service";
import { formatDate } from "@/lib/date";
import type { MessageKey } from "@/i18n/translate";

/** Feeds the existing Print Engine's dedicated "voucher" variant/template — no new template built, per "reuse the Print Engine" instruction. */
export function buildPaymentPrintPayload(
  payment: FinancialTransactionRow,
  options: {
    companyName: string;
    companyLogoUrl: string | null;
    printedByName: string | null;
    t: (key: MessageKey, params?: Record<string, string | number>) => string;
  },
): DocumentPrintPayload {
  const { companyName, companyLogoUrl, printedByName, t } = options;

  const data: DocumentData = {
    type: "payment-voucher",
    documentNumber: payment.transactionNumber,
    documentDate: formatDate(payment.transactionDate),
    currency: payment.currency?.code ?? "",
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
      name: payment.supplier?.name ?? "",
      taxNumber: payment.supplier?.taxNumber ?? undefined,
      addressLines: [
        payment.supplier?.address,
        payment.supplier?.city,
        payment.supplier?.country?.name,
      ].filter((value): value is string => !!value),
      phone: payment.supplier?.phone ?? undefined,
      email: payment.supplier?.email ?? undefined,
    },
    meta: [
      ...(payment.referenceNumber
        ? [{ label: t("purchasing.payments.fields.reference"), value: payment.referenceNumber }]
        : []),
      ...(payment.paymentSource
        ? [
            {
              label: t("financialTransactions.fields.paymentSource"),
              value: payment.paymentSource.name,
            },
          ]
        : []),
    ],
    lineItems: payment.allocations.map((allocation) => ({
      id: allocation.id,
      description: allocation.purchaseInvoice?.invoiceNumber ?? "",
      quantity: 1,
      unitPrice: Number(allocation.allocatedAmount),
      total: Number(allocation.allocatedAmount),
    })),
    totals: [
      {
        label: t("financialTransactions.summary.amount"),
        value: Number(payment.amount),
        emphasis: true,
      },
    ],
    notes: payment.notes ?? undefined,
  };

  return {
    variant: "voucher",
    title: `${t("purchasing.payments.title")} — ${payment.transactionNumber}`,
    printedByName,
    data,
    labels: {
      documentNumber: t("purchasing.payments.fields.number"),
      documentDate: t("financialTransactions.fields.transactionDate"),
      billTo: t("purchasing.suppliers.picker.selectSupplier"),
      description: t("financialTransactions.allocationGrid.invoice"),
      quantity: "",
      unitPrice: "",
      lineTotal: t("financialTransactions.allocationGrid.amount"),
      notes: t("sales.editor.sections.notes"),
    },
  };
}
