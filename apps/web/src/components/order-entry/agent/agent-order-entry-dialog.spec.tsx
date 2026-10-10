import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * R16 S3 — every agent order-entry point (agent admin / agent sales in the
 * portal, a lead conversion, the `/agent/orders/new` deep link, company staff
 * entering an agent order) renders the ONE compact order-entry dialog shell
 * the company store-order dialog uses: the shared width token, the phone
 * bottom-sheet + keyboard-safe sizing, never a full-page form.
 */

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

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace, back: navigation.back }),
  useSearchParams: () => navigation.params,
}));

// The page chrome is not under test — only what the route renders inside it.
vi.mock("@/components/shared/page-workspace", () => ({
  PageWorkspace: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <section data-testid="page-workspace" aria-label={title}>
      {children}
    </section>
  ),
}));

vi.mock("@/hooks/use-duplicate-check", () => ({
  useDuplicateCheck: () => ({
    state: { status: "idle", key: "", result: null, choice: null },
    blocked: false,
    resolution: undefined,
    choose: vi.fn(),
    applyServerResult: vi.fn(),
  }),
}));
vi.mock("@/components/business/duplicate-customer-panel", () => ({
  DuplicateCustomerPanel: () => null,
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
  reportApiError: vi.fn(),
  reportSuccess: vi.fn(),
  apiErrorMessage: (_error: unknown, key: string) => key,
}));

const egypt = { id: "eg", code: "EG", name: "مصر", nameEn: "Egypt" };
const lead = vi.hoisted(() => ({
  id: "lead-1",
  leadNumber: "LD-1",
  customerName: "سارة",
  mobileNumber: "+201001234567",
  city: "القاهرة",
  address: null,
  quantity: 1,
  fulfillmentMethod: "PICKUP",
  createdAt: "2026-10-07",
  salesEmployee: null,
  country: { id: "eg", code: "EG", name: "مصر", nameEn: "Egypt" },
  product: null,
  status: { id: "s1", code: "NEW", name: "جديد", nameEn: "New", color: null },
  storeOrder: null,
  followUpOutcome: null,
  followUpOutcomeAt: null,
}));
vi.mock("@/services/agent-portal-service", () => ({
  agentPortalService: {
    me: vi.fn().mockResolvedValue({ agent: { currency: { id: "egp", code: "EGP" } } }),
    countries: vi.fn().mockResolvedValue([{ id: "eg", code: "EG", name: "مصر", nameEn: "Egypt" }]),
    products: vi.fn().mockResolvedValue({ items: [] }),
    paymentDestinations: vi.fn().mockResolvedValue([]),
    leads: { get: vi.fn().mockResolvedValue(lead), convert: vi.fn() },
    orders: { quote: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/hooks/use-reference-data", () => ({ useCountries: () => [egypt] }));
vi.mock("@/services/products-service", () => ({
  productsService: { catalog: vi.fn().mockResolvedValue({ items: [] }) },
}));
vi.mock("@/services/agents-service", () => ({
  agentsService: {
    users: { list: vi.fn().mockResolvedValue([]) },
    destinations: { list: vi.fn().mockResolvedValue([]) },
  },
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ORDER_ENTRY_DIALOG_CLASS } from "../order-entry-flow";
import { AgentOrderEntryButton, AgentPortalOrderEntryDialog } from "./agent-order-entry-dialog";
import AgentNewOrderPage from "@/app/(shell)/agent/orders/new/page";

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
  navigation.params = new URLSearchParams();
  vi.clearAllMocks();
});

const withProviders = (node: React.ReactNode) => <TooltipProvider>{node}</TooltipProvider>;

/** The dialog surface once the flow (step navigation) is up. */
async function flowDialog(testId: string) {
  await waitFor(() => expect(screen.getByTestId("step-flow-next")).toBeTruthy());
  const dialog = screen.getByRole("dialog");
  expect(dialog.getAttribute("data-testid")).toBe(testId);
  return dialog;
}

/** The compact order-entry shell: shared width token, phone sheet, dvh-bounded, nothing full-page. */
function expectCompactShell(dialog: HTMLElement) {
  const classes = dialog.className.split(/\s+/);
  expect(classes).toContain(ORDER_ENTRY_DIALOG_CLASS);
  // The generic `lg` width is replaced by the token, never stacked with it.
  expect(classes).not.toContain("sm:max-w-3xl");
  // Phones: a near-full-width bottom sheet, lifted above the keyboard, bounded by the dynamic viewport.
  expect(classes).toContain("max-sm:w-auto");
  expect(classes).toContain("max-sm:max-w-none");
  expect(dialog.className).toContain("100dvh");
  expect(dialog.className).toContain("--keyboard-inset");
  // Step navigation and the actions belong to the dialog, not to a page card.
  expect(dialog.contains(screen.getByTestId("step-flow-next"))).toBe(true);
  expect(document.querySelector('[data-slot="card"] [data-step]')).toBeNull();
}

describe("agent order entry — the compact dialog shell (R16 S3)", () => {
  it("the shared width token is the company reference width (48rem = 768px)", () => {
    expect(ORDER_ENTRY_DIALOG_CLASS).toBe("sm:max-w-(--order-entry-width)");
    const css = readFileSync(resolve(__dirname, "../../../app/globals.css"), "utf8");
    expect(css).toMatch(/--order-entry-width:\s*48rem;/);
  });

  it("portal new order (agent admin and agent sales share it) opens in the compact dialog", async () => {
    const onClose = vi.fn();
    render(withProviders(<AgentPortalOrderEntryDialog onClose={onClose} onCreated={vi.fn()} />));
    const dialog = await flowDialog("agent-order-entry");
    expectCompactShell(dialog);
    expect(screen.getByText("agentPortal.orderForm.title")).toBeTruthy();
    expect(document.querySelector("[data-step]")?.getAttribute("data-step")).toBe("customer");
    // The close control closes a clean form at once.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a lead conversion loads the lead into the same compact dialog and keeps its saved phone", async () => {
    render(
      withProviders(
        <AgentPortalOrderEntryDialog leadId="lead-1" onClose={vi.fn()} onCreated={vi.fn()} />,
      ),
    );
    const dialog = await flowDialog("agent-order-entry");
    expectCompactShell(dialog);
    expect(screen.getByText(/agentPortal\.orderForm\.convertTitle/)).toBeTruthy();
    // The existing customer's saved phone is shown as saved — no phone / country fields to re-enter.
    expect(dialog.textContent).toContain("+201001234567");
    expect(dialog.querySelector('input[name="customerPhone"]')).toBeNull();
  });

  it("the /agent/orders/new deep link renders the dialog, never a full-page form", async () => {
    navigation.params = new URLSearchParams("method=PICKUP");
    render(withProviders(<AgentNewOrderPage />));
    const dialog = await flowDialog("agent-order-entry");
    expectCompactShell(dialog);
    // The page itself holds no form of its own.
    expect(screen.getByTestId("page-workspace").querySelector("[data-step]")).toBeNull();
  });

  it("company staff entering an agent order use the same compact dialog", async () => {
    permissions.granted = new Set(["agents.edit"]);
    render(
      withProviders(
        <AgentOrderEntryButton agent={{ id: "agent-1", name: "Agent", currency: null }} />,
      ),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "orderEntry.agent.newOrder" }));
    });
    const dialog = await flowDialog("agent-order-entry-dialog");
    expectCompactShell(dialog);
  });
});
