import { describe, expect, it } from "vitest";
import type {
  PortalStatementPrintData,
  PortalStatementLine,
} from "@/services/agent-portal-service";
import {
  buildPortalStatementPrintPayload,
  portalLineHref,
  portalLineReference,
} from "./statement-print";

const refs = (patch: Partial<PortalStatementLine["references"]> = {}) => ({
  storeOrderId: null,
  orderNumber: null,
  paymentNumber: null,
  payoutId: null,
  payoutNumber: null,
  settlementNumber: null,
  returnNumber: null,
  ...patch,
});

const line = (patch: Partial<PortalStatementLine>): PortalStatementLine => ({
  id: "l",
  entryNumber: "AL-0001",
  entryType: "COMMISSION",
  entryDate: "2026-09-10T00:00:00.000Z",
  description: "",
  debit: 0,
  credit: 0,
  memoAmount: null,
  memo: false,
  balance: 0,
  currencyCode: "EGP",
  availableAt: null,
  references: refs(),
  ...patch,
});

const data: PortalStatementPrintData = {
  document: {
    kind: "AGENT_STATEMENT",
    orientation: "landscape",
    printedAt: "2026-09-28T10:00:00.000Z",
    printedBy: "Agent Admin",
  },
  agent: { id: "a1", agentNumber: "AG-0001", name: "Nile", legalName: "Nile Trading LLC" },
  currency: { id: "c1", code: "EGP", name: "Egyptian pound" },
  period: { from: "2026-09-01", to: "2026-09-30" },
  signConvention: "…",
  openingBalance: 100,
  lines: [
    line({
      id: "1",
      entryType: "COLLECTION_RECEIVED",
      credit: 1000,
      balance: 1100,
      references: refs({ storeOrderId: "o1", orderNumber: "SO-1", paymentNumber: "PAY-1" }),
    }),
    line({
      id: "2",
      entryType: "COLLECTION_BY_AGENT",
      memo: true,
      memoAmount: 500,
      balance: 1100,
      description: "cash",
      references: refs({ paymentNumber: "PAY-2" }),
    }),
    line({
      id: "3",
      entryType: "PAYOUT",
      debit: 300,
      balance: 800,
      references: refs({ payoutId: "p1", payoutNumber: "APO-1" }),
    }),
  ],
  closingBalance: 800,
  totals: { debit: 300, credit: 1000 },
  summary: {} as PortalStatementPrintData["summary"],
};

describe("agent portal statement print", () => {
  const payload = buildPortalStatementPrintPayload(data, {
    title: "Agent statement",
    partyLabel: "Agent",
    periodLabel: "01/09/2026 – 30/09/2026",
    memoLabel: "Memo",
    signNote: "Positive = owed to you",
    company: { name: "OMS", logoUrl: null },
    typeLabel: (type) => type,
  });

  it("prints landscape per the API document", () => {
    expect(payload.orientation).toBe("landscape");
    expect(payload.variant).toBe("account-statement");
    expect(payload.printedByName).toBe("Agent Admin");
  });

  it("carries the agent identity, period, balances and the sign note", () => {
    expect(payload.party).toEqual({ name: "Nile", number: "AG-0001", lines: ["Nile Trading LLC"] });
    expect(payload.partyLabel).toBe("Agent");
    expect(payload.currency).toBe("EGP");
    expect(payload.openingBalance).toBe(100);
    expect(payload.closingBalance).toBe(800);
    expect(payload.periodDebit).toBe(300);
    expect(payload.periodCredit).toBe(1000);
    expect(payload.notes).toEqual(["Positive = owed to you"]);
  });

  it("uses the server's running balances and the most specific reference", () => {
    expect(payload.movements.map((m) => m.balance)).toEqual([1100, 1100, 800]);
    expect(payload.movements.map((m) => m.reference)).toEqual(["SO-1", "PAY-2", "APO-1"]);
  });

  it("prints memo lines with their amount and no debit/credit", () => {
    const memo = payload.movements[1];
    expect(memo.debit).toBe(0);
    expect(memo.credit).toBe(0);
    expect(memo.description).toContain("COLLECTION_BY_AGENT — cash");
    expect(memo.description).toContain("Memo:");
  });

  it("dates lines on the Cairo business day and never prints a missing memo amount as 0.00", () => {
    const late = buildPortalStatementPrintPayload(
      {
        ...data,
        lines: [
          // 22:30Z on 30 Sep = 01:30 on 1 Oct in Cairo.
          line({ id: "4", entryDate: "2026-09-30T22:30:00.000Z", memo: true, memoAmount: null }),
        ],
      },
      {
        title: "Agent statement",
        partyLabel: "Agent",
        periodLabel: "From 01 Sep 2026 · To 30 Sep 2026",
        memoLabel: "Memo",
        signNote: "",
        company: { name: "OMS", logoUrl: null },
        typeLabel: (type) => type,
      },
    );
    expect(late.movements[0].date).toBe("01 Oct 2026");
    expect(late.movements[0].description).toContain("Memo: —");
    expect(late.movements[0].description).not.toContain("0.00");
    expect(late.period).toBe("From 01 Sep 2026 · To 30 Sep 2026");
  });

  it("links references to portal pages", () => {
    expect(portalLineHref(data.lines[0])).toBe("/agent/orders/o1");
    expect(portalLineHref(data.lines[2])).toBe("/agent/payouts/p1");
    expect(portalLineHref(data.lines[1])).toBeNull();
    expect(portalLineReference(line({}))).toBe("AL-0001");
  });
});
