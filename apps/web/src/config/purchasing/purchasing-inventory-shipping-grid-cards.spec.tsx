import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

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

import { PurchaseInvoiceGridCard, PurchaseOrderGridCard } from "./purchasing-grid-cards";
import {
  InventoryMovementGridCard,
  InventoryStockGridCard,
} from "../inventory/inventory-grid-cards";
import { ShipmentGridCard } from "../shipping/shipment-grid-card";
import type { PurchaseOrderRow } from "@/services/purchase-orders-service";
import type { PurchaseInvoiceRow } from "@/services/purchase-invoices-service";
import type { InventoryMovementRow, StockCard } from "@/services/inventory-service";
import type { ShipmentListRow } from "@/services/shipping-service";
import type { ShipmentRowHandlers } from "../shipping/shipment-columns";
import type { InvoiceRowHandlers } from "./invoice-columns";
import type { OrderRowHandlers } from "./order-columns";

afterEach(cleanup);

const noop = () => undefined;
const chrome = { selected: false, onToggleSelected: noop };

/** The row types are far wider than a card reads; build only what the template touches. */
function asRow<T>(row: unknown): T {
  return row as T;
}

const orderHandlers = asRow<OrderRowHandlers>({ usersById: { u9: "Mona Ali" } });
const invoiceHandlers = asRow<InvoiceRowHandlers>({ usersById: {} });

function cardOf() {
  return document.querySelector("[data-record-card]") as HTMLElement;
}

describe("Purchasing / Inventory / Shipping Grid cards (round 9)", () => {
  const order = asRow<PurchaseOrderRow>({
    id: "po-1",
    poNumber: "PO-0001",
    referenceNumber: "SUP-55",
    partner: { name: "Delta Supplies", phone: "+966501234567" },
    status: "APPROVED",
    createdAt: "2026-09-01T10:00:00.000Z",
    createdBy: "u9",
    items: [{ subtotal: "100.00" }, { subtotal: "50.50" }],
  });

  it("maps a purchase order to the card slots and links to the record", () => {
    render(
      <PurchaseOrderGridCard
        row={order}
        handlers={orderHandlers}
        href="/purchasing/purchase-orders/po-1"
        {...chrome}
      />,
    );
    const card = cardOf();
    const link = within(card).getByRole("link");
    expect(link.getAttribute("href")).toBe("/purchasing/purchase-orders/po-1");
    expect(link.textContent).toContain("Delta Supplies");
    expect(card.textContent).toContain("PO-0001");
    expect(card.textContent).toContain("SUP-55");
    expect(card.textContent).toContain("Mona Ali");
    // total is the sum of the line subtotals, as in the table
    expect(card.textContent).toContain("150.50");
    expect(card.getAttribute("data-tone")).toBe("success");
    expect(screen.getByText("purchasing.orders.status.approved")).toBeTruthy();
  });

  it("keeps invoice status and payment status as two separate badges", () => {
    const invoice = asRow<PurchaseInvoiceRow>({
      id: "pi-1",
      invoiceNumber: "PINV-0001",
      referenceNumber: null,
      partner: { name: "Delta Supplies", phone: null },
      status: "CONFIRMED",
      paymentStatus: "PARTIALLY_PAID",
      grandTotal: "900.00",
      createdAt: "2026-09-02T10:00:00.000Z",
      createdBy: null,
    });
    render(
      <PurchaseInvoiceGridCard
        row={invoice}
        handlers={invoiceHandlers}
        href="/purchasing/purchase-invoices/pi-1"
        {...chrome}
      />,
    );
    const status = screen.getByText("purchasing.invoices.status.confirmed");
    const payment = screen.getByText("financialTransactions.invoiceStatus.partiallyPaid");
    expect(status).not.toBe(payment);
    // no supplier reference or creator was supplied, so no field is invented for them
    expect(cardOf().textContent).not.toContain("purchasing.invoices.fields.reference");
    expect(cardOf().textContent).not.toContain("purchasing.invoices.fields.createdBy");
  });

  it("hides the row actions without permission (purchase order)", () => {
    render(
      <PurchaseOrderGridCard
        row={order}
        handlers={orderHandlers}
        href="/purchasing/purchase-orders/po-1"
        {...chrome}
      />,
    );
    // every action is permission-gated, so no actions button is drawn
    expect(within(cardOf()).queryByRole("button", { name: /actions/i })).toBeNull();
  });

  const movement = asRow<InventoryMovementRow>({
    id: "m-1",
    movementNumber: "MOV-0001",
    type: "PURCHASE_RECEIPT",
    quantity: 12,
    quantityBefore: 3,
    quantityAfter: 15,
    unitCost: null,
    product: { sku: "SKU-1", name: "Widget", displayName: "Widget Pro" },
    productId: "p-1",
    warehouse: { code: "WH1", name: "Main" },
    warehouseId: "w-1",
    referenceType: null,
    createdAt: "2026-09-03T10:00:00.000Z",
  });

  it("maps a stock movement: product title, signed quantity, type badge with its tone", () => {
    render(<InventoryMovementGridCard row={movement} {...chrome} />);
    const card = cardOf();
    expect(within(card).queryByRole("link")).toBeNull();
    expect(card.textContent).toContain("Widget Pro");
    expect(card.textContent).toContain("WH1 — Main");
    expect(card.textContent).toContain("MOV-0001");
    expect(card.textContent).toContain("+12");
    expect(screen.getByText("inventory.movementType.PURCHASE_RECEIPT")).toBeTruthy();
    // A movement type is a direction, not a workflow state: the surface stays neutral.
    expect(card.getAttribute("data-tone")).toBe("neutral");
  });

  it("omits the stock value when the API withheld it", () => {
    const stock = asRow<StockCard>({
      productId: "p-1",
      productName: "Widget",
      sku: "SKU-1",
      onHand: 10,
      reserved: 2,
      available: 8,
      stockValue: null,
    });
    render(<InventoryStockGridCard row={stock} />);
    const card = cardOf();
    expect(card.textContent).toContain("SKU-1");
    expect(card.textContent).toContain("inventory.fields.available");
    // Withheld = nothing to say: the card drops the field (the table keeps the column with "—").
    expect(within(card).queryByText("inventory.fields.stockValue")).toBeNull();
    // a read-only list: no checkbox, no link
    expect(within(card).queryByRole("checkbox")).toBeNull();
    expect(within(card).queryByRole("link")).toBeNull();
  });

  it("draws the shipment as text and badges only, linked like the table's identity link", () => {
    const shipment = asRow<ShipmentListRow>({
      id: "s-1",
      storeOrderId: "o-1",
      storeOrder: {
        id: "o-1",
        internalOrderId: "SO-100",
        externalOrderId: "EXT-9",
        partner: { name: "Sara Hassan", phone: "+966501112222", country: { name: "Saudi Arabia" } },
      },
      attemptNumber: 2,
      shippingCompany: { id: "c-1", name: "FastShip" },
      trackingNumber: "TRK123",
      status: "SHIPPED",
      shippingStatus: null,
      shippedAt: "2026-09-04T10:00:00.000Z",
      isCurrentAttempt: true,
    });
    const handlers = asRow<ShipmentRowHandlers>({
      onView: noop,
      onManage: noop,
      quickEdit: { canEdit: true, statuses: [], companies: [], onPatched: noop },
    });
    render(
      <ShipmentGridCard row={shipment} handlers={handlers} href="/store-orders/o-1" {...chrome} />,
    );
    const card = cardOf();
    expect(within(card).getByRole("link").getAttribute("href")).toBe("/store-orders/o-1");
    expect(card.textContent).toContain("SO-100");
    expect(card.textContent).toContain("FastShip");
    expect(card.textContent).toContain("TRK123");
    expect(card.textContent).toContain("Saudi Arabia");
    expect(screen.getByText("shipping.status.SHIPPED")).toBeTruthy();
    expect(card.textContent).toContain("#2");
    // never an inline editor, even for a user who may edit in the table
    expect(within(card).queryByRole("combobox")).toBeNull();
    expect(within(card).queryByRole("textbox")).toBeNull();
    // Manage / View are permission-gated: none granted, so no actions menu
    expect(within(card).queryByRole("button", { name: /actions/i })).toBeNull();
  });
});
