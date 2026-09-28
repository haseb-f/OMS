import { describe, expect, it } from "vitest";
import { buildAgentStatementPrintPayload } from "./agent-statement-print";
import type { AgentStatement, AgentStatementLine } from "@/services/agents-service";

const line = (overrides: Partial<AgentStatementLine>): AgentStatementLine => ({
  id: "l",
  entryNumber: "AL-1",
  entryType: "COLLECTION_RECEIVED",
  entryDate: "2026-09-10T00:00:00.000Z",
  description: "",
  debit: 0,
  credit: 0,
  memoAmount: null,
  currencyCode: "EGP",
  availableAt: null,
  postingStatus: "POSTED",
  sourceType: "X",
  sourceId: "s",
  balance: 0,
  memo: false,
  references: {
    storeOrderId: null,
    orderNumber: null,
    paymentId: null,
    paymentNumber: null,
    payoutId: null,
    payoutNumber: null,
    settlementId: null,
    settlementNumber: null,
    returnNumber: null,
    journalEntryId: null,
    journalEntryNumber: null,
  },
  ...overrides,
});

const statement = {
  agent: {
    id: "ag1",
    agentNumber: "AG-0001",
    name: "Delta",
    legalName: "Delta LLC",
    currency: { id: "c", code: "EGP", name: "Pound" },
  },
  currency: { id: "c", code: "EGP", name: "Pound" },
  period: { from: "2026-09-01", to: "2026-09-30" },
  signConvention: "",
  openingBalance: 100,
  lines: [
    line({
      id: "1",
      credit: 1000,
      balance: 1100,
      description: "Receipt",
      references: { ...line({}).references, orderNumber: "SO-7" },
    }),
    line({
      id: "2",
      entryType: "COLLECTION_BY_AGENT",
      memoAmount: 250,
      memo: true,
      balance: 1100,
    }),
    line({ id: "3", entryType: "COMMISSION", debit: 120, balance: 980 }),
  ],
  closingBalance: 980,
  totals: { debit: 120, credit: 1000 },
  summary: {} as AgentStatement["summary"],
} as AgentStatement;

describe("buildAgentStatementPrintPayload", () => {
  const payload = buildAgentStatementPrintPayload(statement, {
    title: "Agent statement",
    partyLabel: "Agent",
    periodLabel: "01/09/2026 – 30/09/2026",
    memoLabel: "memo",
    signNote: "Positive = we owe the agent",
    company: { name: "Co", logoUrl: null },
    printedByName: "Finance",
    typeLabel: (type) => type,
  });

  it("uses the server balances and totals and the agent identity", () => {
    expect(payload.variant).toBe("account-statement");
    expect(payload.party).toEqual({ name: "Delta", number: "AG-0001", lines: ["Delta LLC"] });
    expect(payload.partyLabel).toBe("Agent");
    expect(payload.currency).toBe("EGP");
    expect(payload.openingBalance).toBe(100);
    expect(payload.closingBalance).toBe(980);
    expect(payload.periodDebit).toBe(120);
    expect(payload.periodCredit).toBe(1000);
    expect(payload.movements.map((m) => m.balance)).toEqual([1100, 1100, 980]);
    expect(payload.notes).toEqual(["Positive = we owe the agent"]);
    expect(payload.recordPath).toBe("/agents/ag1");
    expect(payload.orientation).toBe("landscape");
  });

  it("prints references and states memo amounts without moving the balance", () => {
    expect(payload.movements[0].reference).toBe("SO-7");
    expect(payload.movements[0].description).toBe("COLLECTION_RECEIVED — Receipt");
    expect(payload.movements[1].debit).toBe(0);
    expect(payload.movements[1].credit).toBe(0);
    expect(payload.movements[1].description).toContain("memo: 250.00");
  });
});
