import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * R15 D15-13 — the commission agreement keeps only its shipping policy; its
 * activation reports, as a warning (never a block), that no ACTIVE shipping
 * agreement covers its start date. The rates action is gone.
 */
const granted = new Set<string>(["agents.agreements.manage"]);
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
const toasts = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/toast")>()),
  toast: toasts,
}));

const agreements = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), activate: vi.fn() }));
vi.mock("@/services/agents-service", () => ({ agentsService: { agreements } }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentAgreementsTab } from "../agent-agreements-tab";

beforeAll(() => {
  // jsdom has no ResizeObserver (the row menu's popper measures its anchor).
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const draft = {
  id: "agr",
  agentId: "agent",
  agreementNumber: "AGR-2026-0001",
  status: "DRAFT",
  effectiveFrom: "2026-10-07T00:00:00.000Z",
  effectiveTo: null,
  productCommissionRatePercent: "35",
  serviceCommissionRatePercent: "25",
  shippingPolicy: "PREDETERMINED_CHARGE",
};
const zero = {
  productSales: 0,
  serviceSales: 0,
  productRatePercent: 35,
  serviceRatePercent: 25,
  productCommission: 0,
  serviceCommission: 0,
  totalSales: 0,
  totalCommission: 0,
  customerShipping: 0,
  predeterminedShippingCharge: 0,
  shippingAppliedToCharge: 0,
  shippingDifference: 0,
  totalCollected: 0,
  companyRetains: 0,
  agentEntitlement: 0,
};

describe("AgentAgreementsTab — shipping agreement warning", () => {
  it("shows the activation warning in the UI language and offers no tariff action", async () => {
    agreements.list.mockResolvedValue([draft]);
    agreements.preview.mockResolvedValue({
      agreementId: "agr",
      agreementNumber: "AGR-2026-0001",
      status: "DRAFT",
      effectiveFrom: draft.effectiveFrom,
      currency: { code: "EGP", symbol: null },
      shippingPolicy: "PREDETERMINED_CHARGE",
      example: zero,
      items: [],
    });
    agreements.activate.mockResolvedValue({
      ...draft,
      status: "ACTIVE",
      warnings: [
        {
          code: "SHIPPING_AGREEMENT_NOT_IN_FORCE",
          message:
            "لا توجد اتفاقية شحن مفعّلة تغطي 2026-10-07 — No active shipping agreement covers 2026-10-07.",
        },
      ],
    });
    render(
      <TooltipProvider>
        <AgentAgreementsTab agentId="agent" currencyCode="EGP" onChanged={() => undefined} />
      </TooltipProvider>,
    );

    fireEvent.pointerDown(await screen.findByRole("button", { name: "common.actions" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByText("agents.agreements.actions.activate")).toBeTruthy();
    expect(screen.queryByText("agents.agreements.actions.rates")).toBeNull();
    fireEvent.click(screen.getByText("agents.agreements.actions.activate"));

    const confirm = await screen.findByRole("button", {
      name: "agents.agreements.actions.activate",
    });
    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(toasts.warning).toHaveBeenCalledWith(
        "No active shipping agreement covers 2026-10-07.",
      ),
    );
    expect(toasts.success).toHaveBeenCalledWith("agents.agreements.toasts.activated");
  });
});
