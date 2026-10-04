import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";

type Ctx = {
  status: "loading" | "authenticated" | "unauthenticated";
  permissions: string[];
  isSuperAdmin: boolean;
  user: { userType: "INTERNAL" | "AGENT" } | null;
};
const ctx = vi.hoisted(() => ({
  current: {
    status: "authenticated",
    permissions: [],
    isSuperAdmin: false,
    user: { userType: "INTERNAL" },
  } as Ctx,
}));
vi.mock("@/providers/user-context", () => ({ useUserContext: () => ctx.current }));
vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: MessageKey, params?: Record<string, string | number>) =>
      translate(messages.en, key, params),
    locale: "en",
    direction: "ltr",
  }),
}));

import { HomeLauncher } from "./home-launcher";

const as = (next: Partial<Ctx>) => {
  ctx.current = {
    status: "authenticated",
    permissions: [],
    isSuperAdmin: false,
    user: { userType: "INTERNAL" },
    ...next,
  };
};
const hrefs = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-slot="launcher-tile"]')].map((a) => a.getAttribute("href"));

afterEach(cleanup);

describe("HomeLauncher", () => {
  it("shows skeletons — never the empty state — while permissions are unknown", () => {
    as({ status: "loading", user: null });
    const { container, queryByText } = render(<HomeLauncher />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-slot="launcher-tile"]')).toHaveLength(0);
    expect(queryByText("Nothing to open yet")).toBeNull();
  });

  it("lists only what a sales user may open, and the matching quick action", () => {
    as({ permissions: ["crm.leads.view", "sales.orders.view", "sales.orders.create"] });
    const { container, getByText } = render(<HomeLauncher />);
    const found = hrefs(container);
    expect(found).toContain("/dashboard");
    expect(found).toContain("/modules/crm");
    expect(found).toContain("/sales/orders/new");
    expect(found.some((href) => href?.startsWith("/finance"))).toBe(false);
    expect(found.some((href) => href?.startsWith("/settings"))).toBe(false);
    expect(getByText("Quick actions")).toBeTruthy();
  });

  it("omits the quick-action section when the user can create nothing", () => {
    as({ permissions: ["crm.leads.view"] });
    const { container, queryByText } = render(<HomeLauncher />);
    expect(hrefs(container)).toContain("/modules/crm");
    expect(queryByText("Quick actions")).toBeNull();
  });

  it("shows an agent only portal tiles (Agent Sales sees fewer than Agent Admin)", () => {
    as({
      user: { userType: "AGENT" },
      permissions: ["agent.dashboard.view", "agent.leads.view", "agent.orders.view"],
    });
    const sales = hrefs(render(<HomeLauncher />).container);
    cleanup();
    as({
      user: { userType: "AGENT" },
      permissions: [
        "agent.dashboard.view",
        "agent.leads.view",
        "agent.orders.view",
        "agent.stock.view",
        "agent.statement.view",
        "agent.payouts.view",
        "agent.team.view",
      ],
    });
    const admin = hrefs(render(<HomeLauncher />).container);
    expect(sales.every((href) => href?.startsWith("/agent/"))).toBe(true);
    expect(admin.every((href) => href?.startsWith("/agent/"))).toBe(true);
    expect(admin.length).toBeGreaterThan(sales.length);
    expect(sales).toContain("/agent/dashboard");
  });

  it("gives a super admin every module and none of the agent pages", () => {
    as({ isSuperAdmin: true });
    const found = hrefs(render(<HomeLauncher />).container);
    expect(found).toEqual(expect.arrayContaining(["/dashboard", "/modules/crm", "/modules/sales"]));
    expect(found.some((href) => href === "/agent" || href?.startsWith("/agent/"))).toBe(false);
  });
});
