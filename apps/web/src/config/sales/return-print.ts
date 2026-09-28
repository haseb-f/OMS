import type { DocumentPrintPayload } from "@/types/print-engine";
import type { SalesReturnRow } from "@/services/sales-returns-service";
import {
  buildCommercialPrintPayload,
  type PrintBuilderOptions,
} from "@/config/documents/commercial-print";

/** Sales return print — the shared commercial template (Print Design System spec §3). */
export function buildReturnPrintPayload(
  salesReturn: SalesReturnRow,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  return buildCommercialPrintPayload(
    {
      type: "sales-return",
      titleKey: "printDocument.docTitle.salesReturn",
      documentNumber: salesReturn.returnNumber,
      date: salesReturn.createdAt,
      partner: salesReturn.partner,
      partyRole: "customer",
      currency: salesReturn.currency,
      referenceNumber: salesReturn.referenceNumber,
      sourceNumber: salesReturn.salesInvoice?.invoiceNumber,
      items: salesReturn.items,
      totals: {
        subtotal: Number(salesReturn.subtotal),
        discount: Number(salesReturn.discountTotal),
        tax: Number(salesReturn.taxTotal),
        grandTotal: Number(salesReturn.grandTotal),
      },
      notes: salesReturn.customerNotes,
      recordPath: `/sales/returns/${salesReturn.id}`,
    },
    options,
  );
}
