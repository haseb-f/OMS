import type { DocumentPrintPayload } from "@/types/print-engine";
import type { PurchaseQuotationRow } from "@/services/purchase-quotations-service";
import {
  buildCommercialPrintPayload,
  type PrintBuilderOptions,
} from "@/config/documents/commercial-print";

/** Purchase quotation print — the shared commercial template (Print Design System spec §3). */
export function buildQuotationPrintPayload(
  quotation: PurchaseQuotationRow,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  return buildCommercialPrintPayload(
    {
      type: "purchase-request",
      titleKey: "printDocument.docTitle.purchaseQuotation",
      documentNumber: quotation.quotationNumber,
      date: quotation.documentDate,
      partner: quotation.partner,
      partyRole: "supplier",
      currency: quotation.currency,
      referenceNumber: quotation.referenceNumber,
      items: quotation.items,
      totals: {
        subtotal: Number(quotation.subtotal),
        discount: Number(quotation.discountTotal),
        tax: Number(quotation.taxTotal),
        grandTotal: Number(quotation.grandTotal),
      },
      notes: quotation.supplierNotes,
      recordPath: `/purchasing/purchase-quotations/${quotation.id}`,
    },
    options,
  );
}
