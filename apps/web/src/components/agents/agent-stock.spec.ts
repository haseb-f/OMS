import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { documentHref, INTERNAL_DOCUMENT_LINKS } from "./agent-stock-movements-table";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** R18 B — agent consignment stock UI. */
describe("agent stock history links", () => {
  const receipt = { kind: "AGENT_STOCK_RECEIPT", id: "r-1", number: "ASR-2026-00001" } as const;
  const order = { kind: "STORE_ORDER", id: "o-1", number: "SO-1" } as const;
  const ret = { kind: "AGENT_RETURN", id: "t-1", number: "ART-1", storeOrderId: "o-1" } as const;

  it("internal: receipts open on the receipts page, orders and returns on the order", () => {
    expect(documentHref(receipt, INTERNAL_DOCUMENT_LINKS)).toBe(
      "/agents/stock-receipts?receipt=r-1",
    );
    expect(documentHref(order, INTERNAL_DOCUMENT_LINKS)).toBe("/store-orders/o-1");
    expect(documentHref(ret, INTERNAL_DOCUMENT_LINKS)).toBe("/store-orders/o-1");
  });

  it("R19 A: an assembly order opens on the assembly page internally, never from the portal", () => {
    const assembly = {
      kind: "ASSEMBLY_ORDER",
      id: "a-1",
      number: "ASM-2026-000001",
      recipeVersion: 1,
    } as const;
    expect(documentHref(assembly, INTERNAL_DOCUMENT_LINKS)).toBe("/inventory/assembly/a-1");
    expect(documentHref(assembly, { order: (id: string) => `/agent/orders/${id}` })).toBeNull();
  });

  it("portal: own orders open in the portal, a receipt has no link", () => {
    const portal = { order: (id: string) => `/agent/orders/${id}` };
    expect(documentHref(receipt, portal)).toBeNull();
    expect(documentHref(order, portal)).toBe("/agent/orders/o-1");
    expect(documentHref(ret, portal)).toBe("/agent/orders/o-1");
  });
});

describe("agent stock receipt form", () => {
  it("records quantities only — no cost, price or purchase-invoice field", () => {
    const dialog = source("src/components/agents/agent-stock-receipt-dialog.tsx");
    expect(dialog).not.toMatch(/unitCost|MoneyInput|salesPrice|purchaseInvoice/);
    expect(dialog).toMatch(/agentStockService\.createReceipt/);
    // The old path (a generic inventory adjustment) is gone from the agent tab.
    expect(source("src/components/agents/agent-stock-tab.tsx")).not.toMatch(
      /inventoryService\.adjustment/,
    );
  });
});
