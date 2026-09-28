import type { DocumentPrintPayload } from "@/types/print-engine";
import type { PurchaseInvoiceRow } from "@/services/purchase-invoices-service";
import {
  buildCommercialPrintPayload,
  type PrintBuilderOptions,
} from "@/config/documents/commercial-print";

/** Purchase invoice print — the shared commercial template (Print Design System spec §3). */
export function buildInvoicePrintPayload(
  invoice: PurchaseInvoiceRow,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  return buildCommercialPrintPayload(
    {
      type: "tax-invoice",
      titleKey: "printDocument.docTitle.purchaseInvoice",
      documentNumber: invoice.invoiceNumber,
      date: invoice.createdAt,
      partner: invoice.partner,
      partyRole: "supplier",
      currency: invoice.currency,
      referenceNumber: invoice.referenceNumber,
      sourceNumber: invoice.purchaseOrder?.poNumber,
      items: invoice.items,
      totals: {
        subtotal: Number(invoice.subtotal),
        discount: Number(invoice.discountTotal),
        tax: Number(invoice.taxTotal),
        grandTotal: Number(invoice.grandTotal),
      },
      payment: {
        status: invoice.paymentStatus,
        paid: invoice.allocatedTotal,
        remaining: invoice.remainingBalance,
      },
      notes: invoice.supplierNotes,
      recordPath: `/purchasing/purchase-invoices/${invoice.id}`,
    },
    options,
  );
}
