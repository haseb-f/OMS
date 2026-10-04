import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "en", direction: "ltr" }),
}));

import { SalesOverviewPanel } from "@/components/dashboard/sales-panels";
import type { SalesPerformanceDashboard } from "@/services/sales-performance-service";

const data = {
  kpis: {
    newLeads: 10,
    converted: 4,
    conversionRate: 40,
    orders: 7,
    delivered: 3,
    inProgress: 2,
  },
} as unknown as SalesPerformanceDashboard;

const card = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('[data-slot="insight-card"]')].find((el) =>
    el.textContent?.includes(label),
  );

describe("SalesOverviewPanel — conversion rate card", () => {
  afterEach(cleanup);

  it("behaves like its sibling figures: a real drill-down with focus when the user may open leads", () => {
    const { container } = render(
      <SalesOverviewPanel data={data} period="month" leadsHref="/crm/leads" />,
    );
    const conversion = card(container, "crm.leads.dashboard.conversionRate");
    const sibling = card(container, "crm.leads.dashboard.converted");
    expect(conversion?.tagName).toBe("A");
    expect(conversion?.getAttribute("href")).toBe("/crm/leads");
    expect(conversion?.hasAttribute("data-interactive")).toBe(true);
    expect(conversion?.hasAttribute("data-interactive")).toBe(
      sibling?.hasAttribute("data-interactive"),
    );
    expect(conversion?.className).toMatch(/focus-visible:outline-solid/);
  });

  it("is a static summary — like its siblings — without leads access (never a fake button)", () => {
    const { container } = render(<SalesOverviewPanel data={data} period="month" />);
    const conversion = card(container, "crm.leads.dashboard.conversionRate");
    expect(conversion?.tagName).toBe("DIV");
    expect(conversion?.hasAttribute("data-interactive")).toBe(false);
  });
});
