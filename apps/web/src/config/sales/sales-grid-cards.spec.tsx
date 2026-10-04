import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    direction: "ltr",
    locale: "en",
  }),
}));
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({ user: { id: "u1" }, hasPermission: () => false }),
}));

import { InvoiceGridCard, ReceiptGridCard } from "./sales-grid-cards";
import { PartnerGridCard } from "@/config/partners/partner-grid-card";
import { ProductGridCard } from "@/config/products/product-grid-card";
import type { SalesInvoiceRow } from "@/services/sales-invoices-service";
import type { FinancialTransactionRow } from "@/services/customer-receipts-service";
import type { PartnerRow } from "@/services/partners-service";
import type { ProductRow } from "@/services/products-service";

afterEach(cleanup);

const noop = () => undefined;
const actions: ReactNode = <button type="button">row-actions</button>;
const common = { selected: false, onToggleSelected: noop, actionsNode: actions };

/** The row types are far wider than a card reads; build only what the template touches. */
function asRow<T>(row: unknown): T {
  return row as T;
}

describe("Sales Grid card templates (round 9)", () => {
  const invoice = asRow<SalesInvoiceRow>({
    id: "inv-1",
    invoiceNumber: "INV-0001",
    referenceNumber: "PO-77",
    partner: { name: "Acme Trading", phone: "+966501234567" },
    status: "CONFIRMED",
    paymentStatus: "PARTIALLY_PAID",
    grandTotal: "1150.00",
    remainingBalance: 400,
    createdAt: "2026-09-01T10:00:00.000Z",
  });

  it("maps an invoice to the card slots and links to the record", () => {
    render(<InvoiceGridCard row={invoice} href="/sales/invoices/inv-1" {...common} />);
    const card = document.querySelector("[data-record-card]") as HTMLElement;
    expect(card).toBeTruthy();
    // title is the customer and the card's one link
    const link = within(card).getByRole("link");
    expect(link.getAttribute("href")).toBe("/sales/invoices/inv-1");
    expect(link.textContent).toContain("Acme Trading");
    // reference carries the invoice number and the customer reference
    expect(card.textContent).toContain("INV-0001");
    expect(card.textContent).toContain("PO-77");
    // date and remaining balance are the fields; no due date is invented
    expect(card.textContent).toContain("sales.invoices.fields.date");
    expect(card.textContent).toContain("financialTransactions.paymentSummary.remaining");
    expect(card.textContent).not.toMatch(/due/i);
    // the table's own actions control is rendered
    expect(within(card).getByText("row-actions")).toBeTruthy();
    // tone follows the document status map (CONFIRMED -> success)
    expect(card.getAttribute("data-tone")).toBe("success");
  });

  it("keeps document status and payment status as two separate badges", () => {
    render(<InvoiceGridCard row={invoice} href="/x" {...common} />);
    expect(screen.getByText("sales.invoices.status.confirmed")).toBeTruthy();
    expect(screen.getByText("financialTransactions.invoiceStatus.partiallyPaid")).toBeTruthy();
    const status = screen.getByText("sales.invoices.status.confirmed");
    const payment = screen.getByText("financialTransactions.invoiceStatus.partiallyPaid");
    expect(status).not.toBe(payment);
    expect(status.closest("[data-slot=badge]") ?? status).not.toBe(
      payment.closest("[data-slot=badge]") ?? payment,
    );
  });

  it("shows a refund's linked sales return, and a receipt's reference, under the customer", () => {
    const base = {
      id: "t-1",
      transactionNumber: "RC-0001",
      partner: { name: "Acme Trading" },
      status: "CONFIRMED",
      amount: "200.00",
      createdAt: "2026-09-02T10:00:00.000Z",
      referenceNumber: "BANK-9",
      paymentSource: { id: "p", name: "Main Cash" },
      allocations: [{ salesReturn: { returnNumber: "SR-0003" } }],
    };
    const { unmount } = render(
      <ReceiptGridCard
        row={asRow<FinancialTransactionRow>(base)}
        isRefund={false}
        href="/r"
        {...common}
      />,
    );
    expect(document.body.textContent).toContain("BANK-9");
    expect(document.body.textContent).not.toContain("SR-0003");
    expect(document.body.textContent).toContain("Main Cash");
    unmount();
    render(
      <ReceiptGridCard row={asRow<FinancialTransactionRow>(base)} isRefund href="/r" {...common} />,
    );
    expect(document.body.textContent).toContain("SR-0003");
    expect(document.body.textContent).not.toContain("BANK-9");
  });

  it("never draws a customer's balance or credit limit (no financial figure on the card)", () => {
    const partner = asRow<PartnerRow>({
      id: "c-1",
      partnerNumber: "C-0001",
      name: "Acme Trading",
      phone: "+966501234567",
      email: "buy@acme.test",
      city: "Riyadh",
      country: { name: "Saudi Arabia" },
      deletedAt: null,
      roles: [{ id: "r1", role: "CUSTOMER" }],
      customerProfile: { customerGroup: { name: "Wholesale" }, creditLimit: "987654" },
      supplierProfile: null,
      receivableBalance: 123456,
      payableBalance: 654321,
    });
    render(<PartnerGridCard row={partner} role="customer" href="/c" {...common} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("C-0001");
    expect(text).toContain("Wholesale");
    expect(text).toContain("Riyadh");
    expect(text).toContain("common.active");
    expect(text).not.toMatch(/123[,.]?456|654[,.]?321|987[,.]?654/);
  });

  it("never draws a product's purchase price or cost; shows only the table's sales price", () => {
    const product = asRow<ProductRow>({
      id: "p-1",
      name: "Widget",
      displayName: "Widget Display",
      sku: "SKU-1",
      category: { name: "Gadgets" },
      unit: { name: "Piece" },
      type: "PURCHASE_AND_SALE",
      status: "ACTIVE",
      itemType: "PRODUCT",
      salesPrice: "25.00",
      purchasePrice: "11.11",
      deletedAt: null,
    });
    render(<ProductGridCard row={product} href="/p" {...common} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Widget Display");
    expect(text).toContain("SKU-1");
    expect(text).toContain("Gadgets");
    expect(text).toContain("25");
    expect(text).not.toContain("11.11");
    expect(text).not.toMatch(/margin|cost/i);
    expect(document.querySelector("[data-record-card]")?.getAttribute("data-tone")).toBe("success");
  });
});
