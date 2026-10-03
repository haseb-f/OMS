import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    locale: "en",
    direction: "ltr",
  }),
}));

import { LeadDistributionPool } from "./lead-distribution-pool";
import type { LeadDistributionSnapshot } from "@/services/leads-service";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const snapshot = (over: Partial<LeadDistributionSnapshot> = {}): LeadDistributionSnapshot => ({
  policy: null,
  eligible: [{ id: "1", fullName: "Sara Sales", email: "sara@x.test" }],
  excluded: [
    {
      id: "2",
      fullName: "Fatima Finance",
      email: "f@x.test",
      reason: "NOT_SALES_DESIGNATED",
      reasons: ["NOT_SALES_DESIGNATED"],
    },
    {
      id: "3",
      fullName: "Locked Larry",
      email: "l@x.test",
      reason: "LOCKED",
      reasons: ["LOCKED", "NO_PERMISSION"],
    },
  ],
  ...over,
});

describe("LeadDistributionPool", () => {
  it("renders nothing without a snapshot", () => {
    const { container } = render(<LeadDistributionPool snapshot={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("is collapsed by default; expanding lists eligible users and every excluded user with reason labels", () => {
    render(<LeadDistributionPool snapshot={snapshot()} />);
    expect(screen.getByTestId("lead-distribution-pool").textContent).toContain('"count":1');
    expect(screen.queryByText("Fatima Finance")).toBeNull();
    fireEvent.click(screen.getByText("leadOps.distribution.pool.show"));
    expect(screen.getByText("Sara Sales")).toBeTruthy();
    expect(screen.getByText("Fatima Finance")).toBeTruthy();
    expect(screen.getByText("leadOps.distribution.pool.reasons.NOT_SALES_DESIGNATED")).toBeTruthy();
    // Every failed rule is shown, not just the primary one.
    expect(screen.getByText("leadOps.distribution.pool.reasons.LOCKED")).toBeTruthy();
    expect(screen.getByText("leadOps.distribution.pool.reasons.NO_PERMISSION")).toBeTruthy();
  });

  it("explains an empty pool instead of just counting it", () => {
    render(<LeadDistributionPool snapshot={snapshot({ eligible: [] })} />);
    fireEvent.click(screen.getByText("leadOps.distribution.pool.show"));
    expect(screen.getByText("leadOps.distribution.pool.noneEligible")).toBeTruthy();
  });
});
