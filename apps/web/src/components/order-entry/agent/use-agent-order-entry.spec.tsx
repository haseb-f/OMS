import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// A stable `t`, like the real provider's.
const locale = vi.hoisted(() => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  locale: "ar",
  direction: "rtl",
}));
vi.mock("@/providers/locale-provider", () => ({ useLocale: () => locale }));

const permissions = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/providers/user-context", () => ({
  useUserContext: () => ({ hasPermission: (name: string) => permissions.granted.has(name) }),
}));

// The duplicate check is driven by the test; its inputs are recorded (panel wiring).
const duplicateState = vi.hoisted(() => ({
  blocked: false,
  status: "idle" as string,
  calls: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/hooks/use-duplicate-check", () => ({
  useDuplicateCheck: (args: Record<string, unknown>) => {
    duplicateState.calls.push(args);
    return {
      state: { status: duplicateState.status, key: "", result: null, choice: null },
      blocked: duplicateState.blocked,
      resolution: undefined,
      choose: vi.fn(),
      applyServerResult: vi.fn(),
    };
  },
}));
vi.mock("@/components/business/duplicate-customer-panel", () => ({
  DuplicateCustomerPanel: () => <div data-testid="duplicate-panel" />,
}));
vi.mock("./agent-declaration-fields", () => ({
  AgentDeclarationFields: () => <div data-testid="agent-declaration" />,
}));
// Quotes run at once (no debounce) so the test controls the server answer.
vi.mock("@/hooks/use-debounced-value", () => ({ useDebouncedValue: <T,>(value: T) => value }));
vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
  reportApiError: vi.fn(),
  reportSuccess: vi.fn(),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { OrderEntryFlow, useOrderEntryFlow } from "../order-entry-flow";
import { useAgentOrderEntry } from "./use-agent-order-entry";
import type { AgentEntrySource } from "./agent-entry-source";
import type { PortalLead } from "@/services/agent-portal-service";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  permissions.granted = new Set();
  duplicateState.blocked = false;
  duplicateState.status = "idle";
  duplicateState.calls = [];
});

const countries = [{ id: "eg", code: "EG", name: "مصر", nameEn: "Egypt" }];
const lead = {
  id: "lead-1",
  leadNumber: "LD-1",
  customerName: "سارة",
  mobileNumber: "+201001234567",
  city: "القاهرة",
  address: null,
  quantity: 2,
  fulfillmentMethod: "PICKUP",
  createdAt: "2026-10-07",
  salesEmployee: null,
  country: countries[0],
  product: { id: "p1", name: "كوب", displayName: "كوب", sku: "P1" },
  status: { id: "s1", code: "NEW", name: "جديد", nameEn: "New", color: null },
  storeOrder: null,
  followUpOutcome: null,
  followUpOutcomeAt: null,
} as unknown as PortalLead;

function makeSource(): AgentEntrySource & {
  convert: Mock<AgentEntrySource["convert"]>;
  create: Mock<AgentEntrySource["create"]>;
  quote: Mock<AgentEntrySource["quote"]>;
} {
  return {
    kind: "portal",
    orderHref: (id) => `/agent/orders/${id}`,
    products: vi.fn().mockResolvedValue([
      {
        id: "p1",
        sku: "P1",
        name: "كوب",
        nameEn: "Mug",
        displayName: "كوب",
        listPrice: 300,
        available: 1,
        isInventoryItem: true,
      },
    ]),
    availabilityOwner: null,
    quote: vi.fn<AgentEntrySource["quote"]>().mockResolvedValue({
      valid: true,
      issues: [],
      currencyId: "egp",
      fulfillmentMethod: "PICKUP",
      paymentType: "PREPAID",
      digitalOnly: false,
      shipping: { rate: null, rateScope: null, charge: 0, source: "NONE", overrideAllowed: false },
      lines: [
        {
          productId: "p1",
          name: "كوب",
          quantity: 2,
          listUnitPrice: 300,
          isInventoryItem: true,
          lineAmount: 500,
        },
      ],
      breakdown: {
        mode: "SHIPPING_ADDED",
        merchandiseAmount: 500,
        discountAmount: 0,
        taxAmount: 0,
        shippingCharge: 0,
        serviceCharge: 0,
        payableTotal: 500,
      },
      shippingPricingStatus: "NOT_APPLICABLE",
    }),
    create: vi.fn<AgentEntrySource["create"]>(),
    convert: vi
      .fn<AgentEntrySource["convert"]>()
      .mockResolvedValue({ id: "o1", internalOrderId: "SO-1" }),
    destinations: vi.fn().mockResolvedValue([]),
    checkDuplicates: vi.fn(),
    owners: null,
    declarePermissions: ["agent.payments.declare"],
  };
}

function Harness({
  source,
  withLead,
  onCreated = () => undefined,
}: {
  source: AgentEntrySource;
  withLead: boolean;
  onCreated?: (result: unknown) => void;
}) {
  const flow = useOrderEntryFlow(true);
  const adapter = useAgentOrderEntry({
    source,
    open: true,
    lead: withLead ? lead : null,
    initialMethod: "PICKUP",
    countries,
    currency: { id: "egp", code: "EGP" },
    flow,
    onCreated,
    onCancel: () => undefined,
  });
  return (
    <TooltipProvider>
      <div dir="rtl">
        <OrderEntryFlow flow={flow} adapter={adapter} container="page" onCancel={() => undefined} />
      </div>
    </TooltipProvider>
  );
}

const currentStep = () => document.querySelector("[data-step]")?.getAttribute("data-step") ?? null;
const next = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("step-flow-next"));
  });
};

describe("useAgentOrderEntry in the shared OrderEntryFlow (RTL)", () => {
  it("renders the four shared steps and Next validates only the customer step", async () => {
    render(<Harness source={makeSource()} withLead={false} />);
    expect(currentStep()).toBe("customer");
    expect(
      [...document.querySelectorAll("ol > li")].map((li) => li.getAttribute("data-state")),
    ).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
    await next();
    expect(currentStep()).toBe("customer");
    await waitFor(() =>
      expect(
        document.querySelector('input[name="customerName"]')?.getAttribute("aria-invalid"),
      ).toBe("true"),
    );
  });

  it("wires the agent duplicate check and keeps the user on step 1 until it is answered", async () => {
    duplicateState.blocked = true;
    duplicateState.status = "ready";
    const source = makeSource();
    render(<Harness source={source} withLead />);
    expect(screen.getByTestId("duplicate-panel")).toBeTruthy();
    const last = duplicateState.calls.at(-1)!;
    expect(last.check).toBe(source.checkDuplicates);
    expect(last.phone).toBe(lead.mobileNumber);
    expect(last.name).toBe(lead.customerName);
    await next();
    expect(currentStep()).toBe("customer");
    expect(screen.getAllByText("orderDuplicates.required").length).toBeGreaterThan(0);
  });

  it("offers the payment declaration at create only with agent.payments.declare", async () => {
    for (const granted of [false, true]) {
      permissions.granted = new Set(granted ? ["agent.payments.declare"] : []);
      render(<Harness source={makeSource()} withLead />);
      await next(); // customer → products
      await waitFor(() => expect(currentStep()).toBe("products"));
      fireEvent.change(screen.getByLabelText("agentPortal.orderForm.fields.lineAmount"), {
        target: { value: "500" },
      });
      await next(); // → delivery & payment
      await waitFor(() => expect(currentStep()).toBe("deliveryPayment"));
      expect(Boolean(screen.queryByTestId("agent-declaration"))).toBe(granted);
      cleanup();
    }
  });

  it("converts the lead once with the server-priced lines and one idempotency key", async () => {
    const source = makeSource();
    const onCreated = vi.fn();
    render(<Harness source={source} withLead onCreated={onCreated} />);
    await next();
    await waitFor(() => expect(currentStep()).toBe("products"));
    // The lead's product and quantity are already on the line; the agreed amount is asked.
    await next();
    expect(currentStep()).toBe("products");
    fireEvent.change(screen.getByLabelText("agentPortal.orderForm.fields.lineAmount"), {
      target: { value: "500" },
    });
    // Available 1 < ordered 2: warned, never blocked.
    await waitFor(() => expect(screen.getByTestId("availability-notice")).toBeTruthy());
    await next();
    await waitFor(() => expect(currentStep()).toBe("deliveryPayment"));
    await next();
    await waitFor(() => expect(currentStep()).toBe("review"));
    await waitFor(() => expect(source.quote).toHaveBeenCalled());
    const final = screen.getByTestId("step-flow-final");
    await act(async () => {
      fireEvent.click(final);
      fireEvent.click(final);
    });
    await waitFor(() => expect(source.convert).toHaveBeenCalledTimes(1));
    const [leadId, payload] = source.convert.mock.calls[0];
    expect(leadId).toBe("lead-1");
    expect(payload).not.toHaveProperty("customer");
    expect(payload).not.toHaveProperty("declaration");
    expect(payload).toMatchObject({
      pricingMode: "SHIPPING_ADDED",
      fulfillmentMethod: "PICKUP",
      lines: [{ productId: "p1", quantity: 2, lineAmount: 500 }],
    });
    expect(typeof payload.idempotencyKey).toBe("string");
    expect(source.create).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ id: "o1", internalOrderId: "SO-1" }),
    );
  });
});
