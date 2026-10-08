import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: "ar",
    direction: "rtl",
  }),
}));

import { PositionOverviewPanel, SalesOverviewPanel, TeamOverviewPanel } from "./overview-panels";

afterEach(cleanup);

const fulfillment = {
  total: 3,
  awaitingDispatch: 1,
  dispatched: 1,
  completed: 1,
  withReturns: 0,
  cancelled: 0,
};

describe("agent overview panels (R15 W1)", () => {
  it("shows an employee's own order value, delivered value and returns — nothing agent-level", () => {
    render(
      <SalesOverviewPanel
        id="own"
        currency="EGP"
        own={{ orderValue: 1700 }}
        delivered={{ count: 1, value: 1000 }}
        returnCount={2}
        sales={null}
        returns={null}
        collections={null}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("agentPortal.dashboard.kpi.totalOrderValue");
    expect(text).toContain("agentOverview.delivered");
    expect(text).toContain("agentOverview.returnCount");
    expect(text).not.toContain("agentPortal.dashboard.kpi.pendingCollections");
    expect(text).not.toContain("agentPortal.dashboard.kpi.salesExShipping");
  });

  it("draws nothing for blocks the caller may not see (never zeros)", () => {
    const { container } = render(
      <>
        <SalesOverviewPanel
          id="none"
          currency="EGP"
          sales={null}
          returns={null}
          collections={null}
        />
        <PositionOverviewPanel id="pos" currency="EGP" position={null} payouts={null} />
      </>,
    );
    expect(container.textContent).toBe("");
  });

  it("lists one card per employee, the unassigned row, and money only when present", () => {
    render(
      <TeamOverviewPanel
        id="team"
        currency="EGP"
        rows={[
          {
            user: { id: "u1", fullName: "أمل", isActive: true },
            fulfillment,
            returnCount: 0,
            leads: { total: 4, fresh: 1, converted: 2 },
            sales: { orderValue: 500, deliveredValue: 400, deliveredCount: 1 },
          },
          {
            user: { id: "u2", fullName: "بدر", isActive: false },
            fulfillment,
            returnCount: 1,
            leads: { total: 0, fresh: 0, converted: 0 },
          },
          {
            user: null,
            fulfillment: { ...fulfillment, total: 0 },
            returnCount: 0,
            leads: { total: 1, fresh: 1, converted: 0 },
          },
        ]}
      />,
    );
    const titles = screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent);
    expect(titles).toEqual([
      "أمل",
      "بدر · agentOverview.team.inactive",
      "agentOverview.team.unassigned",
    ]);
    // Money rows only on the card that carries sales.
    expect(screen.getAllByText("agentOverview.delivered")).toHaveLength(1);
  });
});
