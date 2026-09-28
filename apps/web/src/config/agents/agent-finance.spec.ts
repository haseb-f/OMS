import { describe, expect, it } from "vitest";
import {
  deductionBreakdown,
  entryTypeTone,
  isMemoLine,
  ledgerDrillDown,
  lineReference,
  payoutAmountError,
  paymentStageTone,
  paymentTrackPosition,
  PAYMENT_TRACK_STAGES,
} from "./agent-finance";
import type { AgentLedgerReferences } from "@/services/agents-service";

const refs = (overrides: Partial<AgentLedgerReferences> = {}): AgentLedgerReferences => ({
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
  ...overrides,
});

describe("agent statement lines", () => {
  it("a line with no debit and no credit but a memo amount is a memo line", () => {
    expect(isMemoLine({ debit: 0, credit: 0, memoAmount: 500 })).toBe(true);
    expect(isMemoLine({ debit: 0, credit: 0, memoAmount: null })).toBe(false);
    expect(isMemoLine({ debit: 10, credit: 0, memoAmount: null })).toBe(false);
  });

  it("tones: credits success, charges warning, payouts info, memo neutral", () => {
    expect(entryTypeTone({ entryType: "COLLECTION_RECEIVED", debit: 0, credit: 100 })).toBe(
      "success",
    );
    expect(entryTypeTone({ entryType: "COMMISSION", debit: 10, credit: 0 })).toBe("warning");
    expect(entryTypeTone({ entryType: "PAYOUT", debit: 50, credit: 0 })).toBe("info");
    expect(entryTypeTone({ entryType: "COLLECTION_BY_AGENT", debit: 0, credit: 0 })).toBe(
      "neutral",
    );
  });

  it("drill-down links an order and a journal entry, and names the payout", () => {
    const drill = ledgerDrillDown({
      references: refs({
        storeOrderId: "o1",
        orderNumber: "SO-1",
        journalEntryId: "j1",
        journalEntryNumber: "JE-1",
        payoutId: "p1",
        payoutNumber: "APO-1",
      }),
    });
    expect(drill.orderHref).toBe("/store-orders/o1");
    expect(drill.journalHref).toBe("/finance/journal-entries/j1");
    expect(drill.payoutId).toBe("p1");
    expect(ledgerDrillDown({ references: refs() }).orderHref).toBeNull();
  });

  it("reference falls back from order to payout to the entry number", () => {
    expect(lineReference({ entryNumber: "AL-1", references: refs({ orderNumber: "SO-9" }) })).toBe(
      "SO-9",
    );
    expect(
      lineReference({ entryNumber: "AL-1", references: refs({ payoutNumber: "APO-2" }) }),
    ).toBe("APO-2");
    expect(lineReference({ entryNumber: "AL-1", references: refs() })).toBe("AL-1");
  });
});

describe("deductionBreakdown", () => {
  it("keeps every deduction type (zeros included) and totals them in minor units", () => {
    const result = deductionBreakdown({
      deductions: {
        commission: 100.1,
        customerShippingRetained: 0.2,
        shippingFees: 30,
        returnFees: 0,
        serviceFees: 5,
        providerFees: 1.35,
        customerRefunds: 0,
      },
    });
    expect(result.rows).toHaveLength(7);
    expect(result.total).toBe(136.65);
  });
});

describe("payoutAmountError", () => {
  it("requires a positive amount with at most 2 decimals, not above available", () => {
    expect(payoutAmountError("", 100)).toBe("required");
    expect(payoutAmountError("0", 100)).toBe("positive");
    expect(payoutAmountError("-5", 100)).toBe("positive");
    expect(payoutAmountError("10.123", 100)).toBe("decimals");
    expect(payoutAmountError("100.01", 100)).toBe("exceedsAvailable");
    expect(payoutAmountError("100", 100)).toBeNull();
    expect(payoutAmountError("0.1", 0.3)).toBeNull();
  });
});

describe("paymentStageTone", () => {
  it("maps terminal and waiting stages", () => {
    expect(paymentStageTone("REJECTED")).toBe("destructive");
    expect(paymentStageTone("AVAILABLE")).toBe("success");
    expect(paymentStageTone("PENDING_ELIGIBILITY")).toBe("warning");
    expect(paymentStageTone("VERIFIED")).toBe("info");
  });
});

describe("paymentTrackPosition", () => {
  it("positions happy-path stages and marks the final one complete", () => {
    expect(paymentTrackPosition("HELD_WITH_PROVIDER")).toEqual({
      current: "HELD_WITH_PROVIDER",
      currentComplete: false,
      offPath: null,
    });
    expect(paymentTrackPosition("PAID_OUT").currentComplete).toBe(true);
  });
  it("puts rejected, reversed and agent-collected payments off the path", () => {
    expect(paymentTrackPosition("REJECTED")).toEqual({
      current: "DECLARED",
      currentComplete: false,
      offPath: "REJECTED",
    });
    expect(paymentTrackPosition("COLLECTED_BY_AGENT").offPath).toBe("COLLECTED_BY_AGENT");
    expect(paymentTrackPosition("REVERSED").current).toBe("VERIFIED");
  });
  it("lists the provider steps as optional", () => {
    expect(PAYMENT_TRACK_STAGES.filter((s) => s.optional).map((s) => s.key)).toEqual([
      "HELD_WITH_PROVIDER",
      "SETTLED",
    ]);
  });
});
