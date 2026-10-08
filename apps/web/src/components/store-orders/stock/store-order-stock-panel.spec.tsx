import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StoreOrderStockView } from "./stock-api";
import { shipmentQuantityPlan } from "@/components/shipping/shipment-quantities-dialog";
import { movementReferenceLink } from "@/config/traceability/record-routes";

const granted = new Set<string>();
const api = vi.hoisted(() => ({
  view: vi.fn(),
  reserve: vi.fn(),
  receiveBack: vi.fn(),
  nextShipment: vi.fn(),
}));

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    direction: "ltr",
    locale: "en",
  }),
}));
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({
    user: { id: "u1" },
    isSuperAdmin: false,
    hasPermission: (name: string) => granted.has(name),
  }),
}));
vi.mock("./stock-api", () => ({ storeOrderStockApi: api }));

import { StoreOrderStockPanel } from "./store-order-stock-panel";

const line = (overrides: Partial<StoreOrderStockView["lines"][number]> = {}) => ({
  storeOrderItemId: "item-1",
  productId: "p1",
  sku: "SKU-1",
  name: "Product 1",
  stockLine: true,
  ordered: 3,
  reserved: 0,
  inTransit: 0,
  delivered: 0,
  returnedSaleable: 0,
  returnedDamaged: 0,
  short: 0,
  warehouse: { id: "w1", code: "WH-MAIN", name: "Main", role: "STOCK" as const },
  reservations: [],
  ...overrides,
});

const view = (overrides: Partial<StoreOrderStockView> = {}): StoreOrderStockView => ({
  orderId: "o1",
  internalOrderId: "SO-1",
  isAgentOrder: false,
  active: true,
  stockStatus: "RESERVED",
  stockIssue: null,
  canReserve: false,
  postedCogs: null,
  canReceiveBack: false,
  lines: [line({ reserved: 3 })],
  shipments: [],
  movements: [],
  ...overrides,
});

describe("shipmentQuantityPlan (R15 D15-5)", () => {
  it("dispatch defaults to everything reserved; a reship adds what the failed attempt still has with the carrier", () => {
    expect(shipmentQuantityPlan(view(), "dispatch")).toEqual([
      expect.objectContaining({ storeOrderItemId: "item-1", max: 3, carried: 0 }),
    ]);
    const reship = view({
      lines: [line({ reserved: 1, inTransit: 2 })],
      shipments: [
        {
          id: "s1",
          attemptNumber: 1,
          isReship: false,
          status: "NEEDS_RESHIPMENT",
          lines: [
            {
              id: "l1",
              storeOrderItemId: "item-1",
              quantity: 2,
              carried: 0,
              deliveredQuantity: 0,
              returnedQuantity: 0,
              withCarrier: 2,
            },
          ],
        },
        { id: "s2", attemptNumber: 2, isReship: true, status: null, lines: [] },
      ],
    });
    expect(shipmentQuantityPlan(reship, "dispatch")).toEqual([
      expect.objectContaining({ max: 3, carried: 2 }),
    ]);
  });

  it("delivery defaults to what the current parcel carried, minus what came back", () => {
    const delivered = view({
      shipments: [
        {
          id: "s1",
          attemptNumber: 1,
          isReship: false,
          status: "SHIPPED",
          lines: [
            {
              id: "l1",
              storeOrderItemId: "item-1",
              quantity: 3,
              carried: 0,
              deliveredQuantity: 0,
              returnedQuantity: 1,
              withCarrier: 2,
            },
          ],
        },
      ],
    });
    expect(shipmentQuantityPlan(delivered, "deliver")).toEqual([
      expect.objectContaining({ max: 2 }),
    ]);
    // Never more than the order still has to deliver (review H2): 3 carried, 1 of 2 already delivered.
    const capped = { ...delivered, lines: [line({ ordered: 2, delivered: 1 })] };
    capped.shipments[0].lines[0].returnedQuantity = 0;
    expect(shipmentQuantityPlan(capped, "deliver")).toEqual([expect.objectContaining({ max: 1 })]);
  });
});

describe("stock movement references (R15)", () => {
  it("a reservation and a transfer to / from goods in transit link to their store order", () => {
    expect(movementReferenceLink("STORE_ORDER_TRANSIT", "o-1")).toEqual({
      labelKey: "docFlow.kinds.STORE_ORDER",
      href: "/store-orders/o-1",
    });
    expect(movementReferenceLink("STORE_ORDER", "o-1")?.href).toBe("/store-orders/o-1");
  });
});

describe("StoreOrderStockPanel (R15 W5a)", () => {
  beforeEach(() => {
    granted.clear();
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('shows the shortage and offers "Reserve now" only with store-orders.edit', async () => {
    const short = view({
      stockStatus: "SHORT",
      canReserve: true,
      stockIssue: {
        code: "INSUFFICIENT_STOCK",
        messageAr: "ناقص",
        messageEn: "Not enough stock of SKU-1",
        lines: [],
        at: "2026-10-07T00:00:00.000Z",
      },
      lines: [line({ short: 3 })],
    });
    api.view.mockResolvedValue(short);
    const { unmount } = render(<StoreOrderStockPanel orderId="o1" />);
    expect((await screen.findByTestId("stock-issue")).textContent).toContain(
      "Not enough stock of SKU-1",
    );
    expect(screen.queryByTestId("stock-reserve-now")).toBeNull();
    unmount();

    granted.add("store-orders.edit");
    api.reserve.mockResolvedValue(view());
    render(<StoreOrderStockPanel orderId="o1" />);
    fireEvent.click(await screen.findByTestId("stock-reserve-now"));
    await waitFor(() => expect(api.reserve).toHaveBeenCalledWith("o1"));
  });

  it('offers "Receive returned goods" for goods with the carrier only with shipping.receive_returns', async () => {
    const returning = view({
      stockStatus: "RETURNING",
      canReceiveBack: true,
      lines: [line({ inTransit: 2 })],
    });
    api.view.mockResolvedValue(returning);
    const { unmount } = render(<StoreOrderStockPanel orderId="o1" />);
    await screen.findByText("storeOrderStock.status.RETURNING");
    expect(screen.queryByTestId("stock-receive-back")).toBeNull();
    unmount();

    granted.add("shipping.receive_returns");
    render(<StoreOrderStockPanel orderId="o1" />);
    expect(await screen.findByTestId("stock-receive-back")).not.toBeNull();
  });

  it("marks a movement into goods in transit with the warehouse role", async () => {
    api.view.mockResolvedValue(
      view({
        stockStatus: "IN_TRANSIT",
        movements: [
          {
            id: "m1",
            movementNumber: "MV-1",
            type: "TRANSFER",
            productId: "p1",
            sku: "SKU-1",
            warehouse: { id: "t1", code: "WH-TRANSIT", name: "Transit", role: "TRANSIT" },
            quantity: 3,
            referenceType: "STORE_ORDER_TRANSIT",
            referenceId: "o1",
            createdAt: "2026-10-07T10:00:00.000Z",
          },
        ],
      }),
    );
    render(<StoreOrderStockPanel orderId="o1" />);
    fireEvent.click(await screen.findByText("storeOrderStock.movements.title"));
    expect(await screen.findByText("storeOrderStock.warehouseRole.TRANSIT")).not.toBeNull();
  });
});
