import type { DocumentPrintPayload } from "@/types/print-engine";
import type { FinancialTransactionRow } from "@/services/financial-transactions-service";
import {
  buildVoucherPrintPayload,
  type PrintBuilderOptions,
} from "@/config/documents/commercial-print";

/** Customer receipt voucher; a Customer Refund (money out) prints as a refund voucher. */
export function buildReceiptPrintPayload(
  receipt: FinancialTransactionRow,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  const { t } = options;
  const isRefund = receipt.type === "CUSTOMER_REFUND";
  return buildVoucherPrintPayload(
    {
      type: isRefund ? "payment-voucher" : "receipt-voucher",
      variant: "receipt",
      titleKey: isRefund
        ? "printDocument.docTitle.refundVoucher"
        : "printDocument.docTitle.receiptVoucher",
      documentNumber: receipt.transactionNumber,
      date: receipt.transactionDate,
      partner: receipt.partner,
      partyRole: "customer",
      currency: receipt.currency,
      meta: [
        ...(receipt.referenceNumber
          ? [{ label: t("printDocument.reference"), value: receipt.referenceNumber }]
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
      allocations: receipt.allocations.map((allocation) => ({
        id: allocation.id,
        description:
          allocation.salesInvoice?.invoiceNumber ?? allocation.salesReturn?.returnNumber ?? "",
        amount: Number(allocation.allocatedAmount),
      })),
      amount: Number(receipt.amount),
      recordPath: `/sales/payments/${receipt.id}`,
    },
    options,
  );
}
