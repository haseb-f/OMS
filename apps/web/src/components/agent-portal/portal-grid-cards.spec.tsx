import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    direction: "ltr",
    locale: "en",
  }),
}));

import {
  PortalPayoutGridCard,
  PortalStatementGridCard,
  PortalStockGridCard,
} from "./portal-grid-cards";
import type {
  PortalPayoutRow,
  PortalStatementLine,
  PortalStockRow,
} from "@/services/agent-portal-service";

/**
 * R9 - the agent-portal Grid cards show the agent's own portal fields only.
 * Each row below is a valid portal row that ALSO carries properties a company
 * row would have (cost, margin, internal commission, another agent). They are
 * the type system's job to keep out; this proves the cards never read them.
 */
const RESTRICTED = {
  unitCost: "COST-7781.55",
  landedCost: "LANDED-4410.10",
  marginPercent: "MARGIN-37.25",
  internalCommission: "INTERNAL-COMM-912.00",
  commissionRate: "RATE-14.75",
  otherAgentName: "OTHER-AGENT-ZETA",
  agentId: "agent-restricted-id",
  internalNotes: "INTERNAL-NOTE-do-not-show",
  companyProfit: "PROFIT-5521.00",
};

const FORBIDDEN = Object.values(RESTRICTED);

const payout = {
  id: "po-1",
  payoutNumber: "PO-2026-000001",
  status: "CONFIRMED",
  amount: 1250,
  currency: { code: "EGP" },
  payoutDate: "2026-09-20T00:00:00.000Z",
  reference: "BANK-REF-1",
  payingAccount: { name: "Main bank" },
  reversedAt: null,
  attachmentCount: 0,
  allocationCount: 2,
  ...RESTRICTED,
} as PortalPayoutRow;

const line = {
  id: "line-1",
  entryNumber: "JE-1",
  entryType: "ORDER_COMMISSION",
  entryDate: "2026-09-21T00:00:00.000Z",
  description: "Order delivered",
  debit: 0,
  credit: 300,
  memoAmount: null,
  memo: false,
  balance: 300,
  basis: null,
  currencyCode: "EGP",
  availableAt: null,
  references: {
    storeOrderId: "so-1",
    orderNumber: "SO-1001",
    paymentNumber: null,
    payoutId: null,
    payoutNumber: null,
    settlementNumber: null,
    returnNumber: null,
  },
  ...RESTRICTED,
} as unknown as PortalStatementLine;

const stock = {
  productId: "p-1",
  warehouseId: "w-1",
  onHand: 10,
  reserved: 2,
  available: 8,
  shipped: 5,
  returned: 1,
  product: { id: "p-1", sku: "SKU-1", name: "Blue mug", nameEn: "Blue mug", displayName: null },
  warehouse: { id: "w-1", name: "Cairo warehouse", code: "CAI" },
  ...RESTRICTED,
} as PortalStockRow;

const common = { selected: false, onToggleSelected: () => undefined };

afterEach(cleanup);

describe("agent-portal Grid cards", () => {
  it("payout card renders portal fields and nothing outside the portal row type", () => {
    const { container } = render(<PortalPayoutGridCard payout={payout} {...common} />);
    const text = container.textContent ?? "";
    expect(text).toContain("PO-2026-000001");
    expect(text).toContain("Main bank");
    expect(text).toContain("BANK-REF-1");
    for (const secret of FORBIDDEN) expect(text).not.toContain(secret);
    expect(container.innerHTML).not.toContain("agent-restricted-id");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/agent/payouts/po-1");
  });

  it("statement card renders the line's own figures and links to the portal order only", () => {
    const { container } = render(<PortalStatementGridCard line={line} {...common} />);
    const text = container.textContent ?? "";
    expect(text).toContain("SO-1001");
    for (const secret of FORBIDDEN) expect(text).not.toContain(secret);
    expect(container.innerHTML).not.toContain("agent-restricted-id");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/agent/orders/so-1");
  });

  it("stock card renders on-hand quantities and nothing outside the portal row type", () => {
    const { container } = render(<PortalStockGridCard row={stock} {...common} />);
    const text = container.textContent ?? "";
    expect(text).toContain("Blue mug");
    expect(text).toContain("SKU-1");
    expect(text).toContain("Cairo warehouse");
    for (const secret of FORBIDDEN) expect(text).not.toContain(secret);
    // Stock has no detail route: the card must not invent a link.
    expect(container.querySelector("a")).toBeNull();
  });

  it("the source never imports a company row type, service or cost/margin field", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/agent-portal/portal-grid-cards.tsx"),
      "utf8",
    );
    const imports = source.split("\n").filter((entry) => /from\s+"/.test(entry));
    for (const entry of imports) {
      expect(entry).not.toMatch(
        /agents-service|store-orders-service|agent-finance|products-service/,
      );
    }
    // Code (not the doc comment) must not reference restricted business fields.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\b(cost|margin|profit|internalCommission|commissionRate)\b/i);
  });
});
