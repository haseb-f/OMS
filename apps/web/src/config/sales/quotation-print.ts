import type { DocumentPrintPayload } from "@/types/print-engine";
import type { SalesQuotationRow } from "@/services/sales-quotations-service";
import {
  buildCommercialPrintPayload,
  type PrintBuilderOptions,
} from "@/config/documents/commercial-print";

/** Sales quotation (no validity field exists in the data model — none is printed; customer notes are the terms) print — the shared commercial template (Print Design System spec §3). */
export function buildQuotationPrintPayload(
  quotation: SalesQuotationRow,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  return buildCommercialPrintPayload(
    {
      type: "quotation",
      titleKey: "printDocument.docTitle.salesQuotation",
      documentNumber: quotation.quotationNumber,
      date: quotation.documentDate,
      partner: quotation.partner,
      partyRole: "customer",
      currency: quotation.currency,
      referenceNumber: quotation.referenceNumber,
      items: quotation.items,
      totals: {
        subtotal: Number(quotation.subtotal),
        discount: Number(quotation.discountTotal),
        tax: Number(quotation.taxTotal),
        grandTotal: Number(quotation.grandTotal),
      },
      notes: quotation.customerNotes,
      recordPath: `/sales/quotations/${quotation.id}`,
    },
    options,
  );
}
