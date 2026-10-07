import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: "en",
    direction: "ltr",
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import type { DuplicatePanelState } from "@/config/orders/duplicate-panel";
import type { DuplicateCheckResult } from "@/services/order-duplicates-service";
import { DuplicateCustomerPanel } from "./duplicate-customer-panel";

afterEach(cleanup);

const phoneMatch = (withCard: boolean): DuplicateCheckResult => ({
  kind: "PHONE",
  crossScope: false,
  customer: { id: "partner-1", name: "Ahmed Salem", phoneMasked: "+2010•••••123" },
  orders: [],
  otherOrdersCount: 2,
  ...(withCard
    ? {
        disclosure: {
          name: "Ahmed Salem",
          phone: "+201012345123",
          latestOrder: {
            number: "STO-2026-000010",
            orderDate: "2026-10-01",
            productSummary: "Desk · Chair",
            status: "COMPLETED" as const,
          },
          placedOrders: 2,
          completedPurchases: 1,
        },
      }
    : {}),
});

const stateOf = (result: DuplicateCheckResult): DuplicatePanelState => ({
  status: "ready",
  key: "k",
  result,
  choice: null,
});

function renderPanel(result: DuplicateCheckResult) {
  const onChoose = vi.fn();
  const onCancel = vi.fn();
  render(
    <TooltipProvider>
      <DuplicateCustomerPanel
        state={stateOf(result)}
        onChoose={onChoose}
        orderHref={(id) => `/store-orders/${id}`}
        onCancel={onCancel}
      />
    </TooltipProvider>,
  );
  return { onChoose, onCancel };
}

describe("DuplicateCustomerPanel (R14)", () => {
  it("shows the full card for an authorized result, with the repeat-customer badge", () => {
    renderPanel(phoneMatch(true));
    expect(screen.getByTestId("customer-match-card")).toBeTruthy();
    expect(screen.getByText("STO-2026-000010")).toBeTruthy();
    expect(screen.getByTestId("repeat-customer-badge")).toBeTruthy();
    expect(screen.queryByText("+2010•••••123")).toBeNull();
  });

  it("stays masked without a disclosure", () => {
    renderPanel(phoneMatch(false));
    expect(screen.queryByTestId("customer-match-card")).toBeNull();
    expect(screen.getByText("+2010•••••123")).toBeTruthy();
  });

  it("offers two explicit decisions: a new order for the same customer, or cancel", () => {
    const { onChoose, onCancel } = renderPanel(phoneMatch(true));
    fireEvent.click(screen.getByText("orderDuplicates.phone.newOrder"));
    expect(onChoose).toHaveBeenCalledWith({ kind: "NEW_ORDER", customerId: "partner-1" });
    fireEvent.click(screen.getByTestId("duplicate-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("a cross-scope match is answered the same way (new order for the same customer + review)", () => {
    const { onChoose, onCancel } = renderPanel({ kind: "PHONE", crossScope: true });
    fireEvent.click(screen.getByText("orderDuplicates.phone.newOrder"));
    expect(onChoose).toHaveBeenCalledWith({ kind: "CONTINUE_WITH_REVIEW" });
    fireEvent.click(screen.getByTestId("duplicate-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
