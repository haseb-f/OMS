import type { DocumentPrintPayload } from "@/types/print-engine";
import type { SalesOrderRow } from "@/services/sales-orders-service";
import {
  buildCommercialPrintPayload,
  type PrintBuilderOptions,
} from "@/config/documents/commercial-print";

/** Sales order print — the shared commercial template (Print Design System spec §3). */
export function buildOrderPrintPayload(
  order: SalesOrderRow,
  options: PrintBuilderOptions,
): DocumentPrintPayload {
  return buildCommercialPrintPayload(
    {
      type: "sales-order",
      titleKey: "printDocument.docTitle.salesOrder",
      documentNumber: order.orderNumber,
      date: order.createdAt,
      partner: order.partner,
      partyRole: "customer",
      currency: order.currency,
      referenceNumber: order.referenceNumber,
      sourceNumber: order.quotation?.quotationNumber,
      items: order.items,
      totals: {
        subtotal: Number(order.subtotal),
        discount: Number(order.discountTotal),
        tax: Number(order.taxTotal),
        grandTotal: Number(order.grandTotal),
      },
      notes: order.customerNotes,
      recordPath: `/sales/orders/${order.id}`,
    },
    options,
  );
}
