import type { DocumentPrintPayload } from "@/types/print-engine";
import type { PurchaseOrderRow } from "@/services/purchase-orders-service";
import {
  buildCommercialPrintPayload,
  type PrintBuilderOptions,
} from "@/config/documents/commercial-print";

/**
 * Purchase order print — the shared commercial template. A Purchase Order
 * stores no aggregate columns (ADR-0015), so the totals are the sums of the
 * stored line values: `subtotal` is each line's taxable amount (after its
 * discount), plus its `taxAmount`, and `lineTotal` for the grand total.
 */
export function buildOrderPrintPayload(
  order: PurchaseOrderRow,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  const sum = (pick: (item: PurchaseOrderRow["items"][number]) => string) =>
    order.items.reduce((total, item) => total + Number(pick(item)), 0);
  return buildCommercialPrintPayload(
    {
      type: "purchase-order",
      titleKey: "printDocument.docTitle.purchaseOrder",
      documentNumber: order.poNumber,
      date: order.createdAt,
      partner: order.partner,
      partyRole: "supplier",
      currency: order.currency,
      referenceNumber: order.referenceNumber,
      sourceNumber: order.quotation?.quotationNumber,
      items: order.items,
      totals: {
        subtotal: sum((item) => item.subtotal),
        tax: sum((item) => item.taxAmount),
        grandTotal: sum((item) => item.lineTotal),
      },
      notes: order.supplierNotes,
      recordPath: `/purchasing/purchase-orders/${order.id}`,
    },
    options,
  );
}
