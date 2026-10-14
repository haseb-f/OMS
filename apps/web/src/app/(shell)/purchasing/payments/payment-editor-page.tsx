"use client";

import {
  VoucherEditorPage,
  type VoucherPageConfig,
} from "@/components/financial-transactions/voucher-editor-page";
import type { AllocationGridLine } from "@/components/financial-transactions/allocation-grid";
import {
  supplierPaymentsService,
  type FinancialTransactionRow,
} from "@/services/supplier-payments-service";
import { buildPaymentPrintPayload } from "@/config/purchasing/payment-print";

const invoiceHref = (invoiceId: string) => `/purchasing/purchase-invoices/${invoiceId}`;

function allocationToLine(
  allocation: FinancialTransactionRow["allocations"][number],
): AllocationGridLine {
  return {
    id: allocation.id,
    invoiceId: allocation.purchaseInvoiceId ?? "",
    invoiceNumber: allocation.purchaseInvoice?.invoiceNumber ?? "—",
    invoiceHref: invoiceHref(allocation.purchaseInvoiceId ?? ""),
    remainingBalance: Number(allocation.allocatedAmount),
    allocatedAmount: Number(allocation.allocatedAmount),
    grandTotal: allocation.purchaseInvoice ? Number(allocation.purchaseInvoice.grandTotal) : null,
  };
}

/** The supplier side of the one voucher card (R22): payments, advances, other payments, transfers, → expenses. */
const PAYMENT_CONFIG: VoucherPageConfig = {
  direction: "OUT",
  partyRole: "SUPPLIER",
  relatedKind: "SUPPLIER_PAYMENT",
  basePath: "/purchasing/payments",
  permissionPrefix: "purchasing.payments",
  titleKey: "purchasing.payments.editorTitle",
  partyLabelKey: "purchasing.payments.partyLabel",
  addNewKey: "purchasing.payments.addNew",
  docCodePreview: "SP",
  service: supplierPaymentsService,
  invoiceHref,
  allocationToLine,
  buildPrint: buildPaymentPrintPayload,
};

export function PaymentEditorPage({ id }: { id: string | null }) {
  return <VoucherEditorPage id={id} config={PAYMENT_CONFIG} />;
}
