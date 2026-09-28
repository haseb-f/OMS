import type { DocumentPrintPayload } from "@/types/print-engine";
import type { SalesInvoiceRow } from "@/services/sales-invoices-service";
import {
  buildCommercialPrintPayload,
  type PrintBuilderOptions,
} from "@/config/documents/commercial-print";

/** Sales invoice print — the shared commercial template (Print Design System spec §3). */
export function buildInvoicePrintPayload(
  invoice: SalesInvoiceRow,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  return buildCommercialPrintPayload(
    {
      type: "tax-invoice",
      titleKey: "printDocument.docTitle.salesInvoice",
      documentNumber: invoice.invoiceNumber,
      date: invoice.createdAt,
      partner: invoice.partner,
      partyRole: "customer",
      currency: invoice.currency,
      referenceNumber: invoice.referenceNumber,
      sourceNumber: invoice.salesOrder?.orderNumber,
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
      notes: invoice.customerNotes,
      recordPath: `/sales/invoices/${invoice.id}`,
    },
    options,
  );
}
