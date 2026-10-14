"use client";

import {
  VoucherEditorPage,
  type VoucherPageConfig,
} from "@/components/financial-transactions/voucher-editor-page";
import type { AllocationGridLine } from "@/components/financial-transactions/allocation-grid";
import {
  customerReceiptsService,
  type FinancialTransactionRow,
} from "@/services/customer-receipts-service";
import { buildReceiptPrintPayload } from "@/config/sales/receipt-print";

const invoiceHref = (invoiceId: string) => `/sales/invoices/${invoiceId}`;

function allocationToLine(
  allocation: FinancialTransactionRow["allocations"][number],
): AllocationGridLine {
  // R15 (D15-11) — the part of the receipt paid back by its order's advance
  // refund: shown as the order (removing it is refused — cancel the refund).
  if (allocation.storeOrderId && !allocation.salesInvoiceId) {
    return {
      id: allocation.id,
      invoiceId: allocation.storeOrderId,
      invoiceNumber: allocation.storeOrder?.internalOrderId ?? "—",
      invoiceHref: `/store-orders/${allocation.storeOrderId}`,
      remainingBalance: Number(allocation.allocatedAmount),
      allocatedAmount: Number(allocation.allocatedAmount),
      locked: true,
    };
  }
  return {
    id: allocation.id,
    invoiceId: allocation.salesInvoiceId ?? "",
    invoiceNumber: allocation.salesInvoice?.invoiceNumber ?? "—",
    invoiceHref: invoiceHref(allocation.salesInvoiceId ?? ""),
    remainingBalance: Number(allocation.allocatedAmount),
    allocatedAmount: Number(allocation.allocatedAmount),
    grandTotal: allocation.salesInvoice ? Number(allocation.salesInvoice.grandTotal) : null,
  };
}

/** The customer side of the one voucher card (R22): receipts, advances, other receipts, transfers. */
const RECEIPT_CONFIG: VoucherPageConfig = {
  direction: "IN",
  partyRole: "CUSTOMER",
  relatedKind: "CUSTOMER_RECEIPT",
  basePath: "/sales/payments",
  permissionPrefix: "sales.receipts",
  titleKey: "sales.receipts.editorTitle",
  partyLabelKey: "sales.receipts.partyLabel",
  addNewKey: "sales.receipts.addNew",
  docCodePreview: "CR",
  service: customerReceiptsService,
  invoiceHref,
  allocationToLine,
  buildPrint: buildReceiptPrintPayload,
};

export function ReceiptEditorPage({ id }: { id: string | null }) {
  return <VoucherEditorPage id={id} config={RECEIPT_CONFIG} />;
}
