import type { DocumentPrintPayload } from "@/types/print-engine";
import type { FinancialTransactionRow } from "@/services/financial-transactions-service";
import {
  buildVoucherPrintPayload,
  type PrintBuilderOptions,
} from "@/config/documents/commercial-print";

/** Supplier payment voucher — the shared voucher layout. */
export function buildPaymentPrintPayload(
  payment: FinancialTransactionRow,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  const { t } = options;
  return buildVoucherPrintPayload(
    {
      type: "payment-voucher",
      variant: "voucher",
      titleKey: "printDocument.docTitle.paymentVoucher",
      documentNumber: payment.transactionNumber,
      date: payment.transactionDate,
      partner: payment.partner,
      partyRole: "supplier",
      currency: payment.currency,
      meta: [
        ...(payment.referenceNumber
          ? [{ label: t("printDocument.reference"), value: payment.referenceNumber }]
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
      allocations: payment.allocations.map((allocation) => ({
        id: allocation.id,
        description: allocation.purchaseInvoice?.invoiceNumber ?? "",
        amount: Number(allocation.allocatedAmount),
      })),
      amount: Number(payment.amount),
      recordPath: `/purchasing/payments/${payment.id}`,
    },
    options,
  );
}
