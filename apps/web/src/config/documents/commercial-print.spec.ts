import { describe, expect, it } from "vitest";
import { buildInvoicePrintPayload as buildSalesInvoice } from "@/config/sales/invoice-print";
import { buildQuotationPrintPayload as buildSalesQuotation } from "@/config/sales/quotation-print";
import { buildOrderPrintPayload as buildPurchaseOrder } from "@/config/purchasing/order-print";
import { buildPaymentPrintPayload } from "@/config/purchasing/payment-print";
import type { SalesInvoiceRow } from "@/services/sales-invoices-service";
import type { SalesQuotationRow } from "@/services/sales-quotations-service";
import type { PurchaseOrderRow } from "@/services/purchase-orders-service";
import type { FinancialTransactionRow } from "@/services/financial-transactions-service";

const t = (key: string) => key;
const options = { companyName: "Co", companyLogoUrl: null, printedByName: "Tester", t };

const partner = {
  name: "Acme",
  partnerNumber: "C-0001",
  taxNumber: "300",
  address: "Street 1",
  city: "Cairo",
  country: { id: "eg", code: "EG", name: "Egypt" },
  phone: null,
  mobile: "0100",
  email: null,
};

const line = {
  id: "l1",
  product: { name: "Widget", displayName: "Widget", sku: "W-1" },
  description: null,
  unit: { name: "pc" },
  quantity: 2,
  unitPrice: "100",
  discountPercent: "10",
  discountValue: "5",
  tax: { name: "VAT", rate: "14" },
  taxAmount: "24.5",
  lineTotal: "199.5",
};

describe("commercial print builders", () => {
  it("sales invoice: customer role, own title, currency, lines and server payment status", () => {
    const payload = buildSalesInvoice(
      {
        id: "i1",
        invoiceNumber: "INV-1",
        createdAt: "2026-09-01T10:00:00Z",
        partner,
        currency: { code: "EGP" },
        referenceNumber: "PO-9",
        salesOrder: { orderNumber: "SO-3" },
        customerNotes: "Pay within 30 days",
        internalNotes: "never printed",
        subtotal: "200",
        discountTotal: "25",
        taxTotal: "24.5",
        grandTotal: "199.5",
        paymentStatus: "PARTIALLY_PAID",
        allocatedTotal: 100,
        remainingBalance: 99.5,
        items: [line],
      } as unknown as SalesInvoiceRow,
      options,
    );
    expect(payload.title).toBe("printDocument.docTitle.salesInvoice");
    expect(payload.data.partyRole).toBe("customer");
    expect(payload.data.currency).toBe("EGP");
    expect(payload.data.party).toMatchObject({
      name: "Acme",
      number: "C-0001",
      phone: "0100",
      addressLines: ["Street 1", "Cairo", "Egypt"],
    });
    expect(payload.data.payment).toEqual({
      statusLabel: "financialTransactions.invoiceStatus.partiallyPaid",
      paid: 100,
      remaining: 99.5,
    });
    expect(payload.data.lineItems[0]).toMatchObject({
      description: "Widget",
      sku: "W-1",
      discount: 5,
      discountPercent: 10,
      taxLabel: "VAT 14%",
      taxAmount: 24.5,
      total: 199.5,
    });
    expect(payload.data.totals.map((row) => row.value)).toEqual([200, 25, 24.5, 199.5]);
    expect(payload.data.notes).toBe("Pay within 30 days");
    expect(JSON.stringify(payload)).not.toContain("never printed");
    expect(payload.data.meta).toEqual([
      { label: "printDocument.reference", value: "PO-9" },
      { label: "printDocument.sourceDocument", value: "SO-3" },
    ]);
  });

  it("quotation carries no invented validity and no payment status", () => {
    const payload = buildSalesQuotation(
      {
        id: "q1",
        quotationNumber: "QT-1",
        documentDate: "2026-09-01",
        partner,
        currency: null,
        referenceNumber: null,
        customerNotes: null,
        subtotal: "200",
        discountTotal: "0",
        taxTotal: "0",
        grandTotal: "200",
        items: [],
      } as unknown as SalesQuotationRow,
      options,
    );
    expect(payload.title).toBe("printDocument.docTitle.salesQuotation");
    expect(payload.data.payment).toBeUndefined();
    expect(payload.data.meta).toEqual([]);
    // Zero discount / tax rows are omitted.
    expect(payload.data.totals.map((row) => row.label)).toEqual([
      "printDocument.subtotal",
      "printDocument.grandTotal",
    ]);
  });

  it("purchase order: supplier role; totals from stored line values", () => {
    const payload = buildPurchaseOrder(
      {
        id: "p1",
        poNumber: "PO-1",
        createdAt: "2026-09-01",
        partner,
        currency: { code: "USD" },
        items: [{ ...line, subtotal: "175" }],
        supplierNotes: null,
      } as unknown as PurchaseOrderRow,
      options,
    );
    expect(payload.data.partyRole).toBe("supplier");
    expect(payload.title).toBe("printDocument.docTitle.purchaseOrder");
    expect(payload.data.totals.map((row) => row.value)).toEqual([175, 24.5, 199.5]);
  });

  it("payment voucher: supplier party, applied-to lines, amount, signatures", () => {
    const payload = buildPaymentPrintPayload(
      {
        id: "t1",
        transactionNumber: "PAY-1",
        transactionDate: "2026-09-01",
        partner,
        currency: { code: "EGP" },
        amount: "300",
        allocations: [
          { id: "a1", allocatedAmount: "300", purchaseInvoice: { invoiceNumber: "PI-7" } },
        ],
      } as unknown as FinancialTransactionRow,
      options,
    );
    expect(payload.variant).toBe("voucher");
    expect(payload.data.partyRole).toBe("supplier");
    expect(payload.data.lineItems[0]).toMatchObject({ description: "PI-7", total: 300 });
    expect(payload.data.totals).toEqual([
      { label: "printDocument.amount", value: 300, emphasis: true },
    ]);
    expect(payload.data.signatures).toHaveLength(3);
  });
});
