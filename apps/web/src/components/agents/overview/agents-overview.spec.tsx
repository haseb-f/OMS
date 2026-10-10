import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: "ar",
    direction: "rtl",
  }),
}));

const list = vi.fn();
const agents = vi.fn();
vi.mock("@/services/agents-service", () => ({
  agentsService: { list: (...a: unknown[]) => list(...a) },
}));
vi.mock("./overview-api", () => ({
  agentOverviewApi: { agents: (...a: unknown[]) => agents(...a) },
}));

import { AGENTS_OVERVIEW_PAGE_SIZE, AgentsOverview } from "./agents-overview";
import { PositionOverviewPanel, SalesOverviewPanel, TeamOverviewPanel } from "./overview-panels";

afterEach(cleanup);
beforeEach(() => {
  list.mockReset();
  agents.mockReset();
});

const fulfillment = {
  total: 4,
  awaitingDispatch: 1,
  dispatched: 1,
  completed: 2,
  withReturns: 0,
  cancelled: 0,
};
const agentRef = (id: string) => ({
  id,
  agentNumber: `AG-${id}`,
  name: `Agent ${id}`,
  status: "ACTIVE" as const,
  currency: { code: "EGP" },
});
const totals = (finance: boolean) => ({
  agents: { total: 2, active: 2 },
  orders: { open: 3, withReturns: 1 },
  leads: { total: 5, fresh: 2, converted: 1 },
  ...(finance ? { collections: { awaitingVerificationCount: 1 } } : {}),
});

describe("Agents overview page content (R16 S2)", () => {
  it("asks for one page of agents and their figures only — never more", async () => {
    list.mockResolvedValue({ items: [{ id: "a1" }, { id: "a2" }], total: 2 });
    agents.mockResolvedValue({
      finance: false,
      totals: totals(false),
      items: [
        { agent: agentRef("a1"), fulfillment, returnCount: 0, leads: totals(false).leads },
        { agent: agentRef("a2"), fulfillment, returnCount: 1, leads: totals(false).leads },
      ],
    });
    render(<AgentsOverview />);
    await waitFor(() => expect(screen.getByText("Agent a1 · AG-a1")).toBeTruthy());
    expect(list).toHaveBeenCalledWith({ page: 1, pageSize: AGENTS_OVERVIEW_PAGE_SIZE });
    expect(agents).toHaveBeenCalledWith(["a1", "a2"]);
    expect(AGENTS_OVERVIEW_PAGE_SIZE).toBeLessThanOrEqual(50);
  });

  it("without finance access: counts only — no money row, no collections tile", async () => {
    list.mockResolvedValue({ items: [{ id: "a1" }], total: 1 });
    agents.mockResolvedValue({
      finance: false,
      totals: totals(false),
      items: [{ agent: agentRef("a1"), fulfillment, returnCount: 0, leads: totals(false).leads }],
    });
    render(<AgentsOverview />);
    await waitFor(() => expect(screen.getByText("Agent a1 · AG-a1")).toBeTruthy());
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("agentOverview.agents.availableForPayout");
    expect(text).not.toContain("agentPortal.dashboard.kpi.totalOrderValue");
    expect(text).not.toContain("agentOverview.agents.awaitingVerification");
  });

  it("with finance access: per-agent money in the agent's currency; every card opens the agent", async () => {
    list.mockResolvedValue({ items: [{ id: "a1" }], total: 1 });
    agents.mockResolvedValue({
      finance: true,
      totals: totals(true),
      items: [
        {
          agent: agentRef("a1"),
          fulfillment,
          returnCount: 0,
          leads: totals(true).leads,
          sales: {
            merchandiseSalesExShipping: 900,
            customerShippingCharges: 100,
            totalOrderValue: 1000,
          },
          position: { balance: 400, pending: 100, available: 300, paidOut: 0 },
        },
      ],
    });
    const { container } = render(<AgentsOverview />);
    await waitFor(() => expect(screen.getByText("Agent a1 · AG-a1")).toBeTruthy());
    const text = document.body.textContent ?? "";
    expect(text).toContain("agentOverview.agents.availableForPayout");
    expect(text).toContain("agentOverview.agents.awaitingVerification");
    const card = screen.getByRole("link", { name: /Agent a1/ });
    expect(card.getAttribute("href")).toBe("/agents/a1");
    expect(card.hasAttribute("data-interactive")).toBe(true);
    // Read-only: no create / edit control on the overview.
    expect(container.querySelector("form, input")).toBeNull();
  });
});

/**
 * Agent-facing cards (portal dashboard) never show internal company cost /
 * margin: even when an object carries such fields, nothing of it is drawn.
 */
describe("agent-facing summary cards redact company cost and margin", () => {
  const POISON = {
    unitCost: "COST-7781.55",
    landedCost: "LANDED-4410.10",
    marginPercent: "MARGIN-37.25",
    companyProfit: "PROFIT-5521.00",
    internalCommission: "INTERNAL-91.40",
  };

  it("renders none of the poisoned fields in the sales, position and team cards", () => {
    render(
      <>
        <SalesOverviewPanel
          id="sales"
          currency="EGP"
          sales={{
            merchandiseSalesExShipping: 900,
            customerShippingCharges: 100,
            totalOrderValue: 1000,
            ...POISON,
          }}
          delivered={{ count: 1, value: 500, ...POISON }}
          returns={{ merchandiseReturned: 0, ...POISON }}
          returnCount={0}
          collections={{ awaitingVerificationCount: 0, awaitingVerificationAmount: 0, ...POISON }}
        />
        <PositionOverviewPanel
          id="position"
          currency="EGP"
          position={{ balance: 1, pending: 0, available: 1, ...POISON }}
          payouts={{ count: 0, total: 0, ...POISON }}
        />
        <TeamOverviewPanel
          id="team"
          currency="EGP"
          rows={[
            {
              user: { id: "u1", fullName: "Amal", isActive: true },
              fulfillment,
              returnCount: 0,
              sales: { orderValue: 10, deliveredValue: 5, deliveredCount: 1, ...POISON },
              ...POISON,
            },
          ]}
        />
      </>,
    );
    const text = document.body.textContent ?? "";
    for (const value of Object.values(POISON)) expect(text).not.toContain(value);
    expect(text).not.toMatch(/cost|margin|profit/i);
  });

  it("the agent dashboard and the card set never reference cost / margin / profit fields", () => {
    for (const file of [
      "src/app/(shell)/agent/dashboard/page.tsx",
      "src/components/agents/overview/overview-panels.tsx",
      "src/components/agents/overview/overview-api.ts",
      "src/components/agents/summary-card.tsx",
    ]) {
      const code = readFileSync(resolve(process.cwd(), file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\w*(cost|margin|profit)\w*/i);
    }
  });
});
