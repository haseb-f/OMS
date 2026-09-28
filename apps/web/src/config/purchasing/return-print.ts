import type { DocumentPrintPayload } from "@/types/print-engine";
import type { PurchaseReturnRow } from "@/services/purchase-returns-service";
import {
  buildCommercialPrintPayload,
  type PrintBuilderOptions,
} from "@/config/documents/commercial-print";

/** Purchase return print — the shared commercial template (Print Design System spec §3). */
export function buildReturnPrintPayload(
  purchaseReturn: PurchaseReturnRow,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  return buildCommercialPrintPayload(
    {
      type: "sales-return",
      titleKey: "printDocument.docTitle.purchaseReturn",
      documentNumber: purchaseReturn.returnNumber,
      date: purchaseReturn.createdAt,
      partner: purchaseReturn.partner,
      partyRole: "supplier",
      currency: purchaseReturn.currency,
      referenceNumber: purchaseReturn.referenceNumber,
      sourceNumber: purchaseReturn.purchaseInvoice?.invoiceNumber,
      items: purchaseReturn.items,
      totals: {
        subtotal: Number(purchaseReturn.subtotal),
        discount: Number(purchaseReturn.discountTotal),
        tax: Number(purchaseReturn.taxTotal),
        grandTotal: Number(purchaseReturn.grandTotal),
      },
      notes: purchaseReturn.supplierNotes,
      recordPath: `/purchasing/purchase-returns/${purchaseReturn.id}`,
    },
    options,
  );
}
