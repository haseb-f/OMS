import { describe, expect, it } from "vitest";
import {
  canQuickConfirm,
  defaultAllocationAmount,
  missingRequiredFields,
  validateAllocations,
  visibleReasons,
  willPost,
} from "./reconciliation-model";
import type { Suggestion, SuggestionResult } from "@/services/payment-reconciliation-service";

function candidate(overrides: Partial<Suggestion>): Suggestion {
  return {
    paymentId: "p1",
    score: 140,
    strength: "STRONG",
    reasons: [],
    amountMatches: true,
    suggestible: true,
    dayDistance: 0,
    claim: {} as Suggestion["claim"],
    ...overrides,
  };
}

function result(ambiguous: boolean): SuggestionResult {
  return {
    line: {
      id: "l1",
      amount: 100,
      matchedAmount: 0,
      remaining: 100,
      currency: { id: "c", code: "SAR" },
      status: "UNMATCHED",
      providerStatusClass: "SUCCESS",
    },
    candidates: [],
    ambiguous,
    blockedReason: null,
  };
}

describe("reconciliation allocation rules", () => {
  it("accepts a full single allocation and flags it as posting", () => {
    const drafts = [{ paymentId: "a", remaining: 100, amount: 100 }];
    expect(validateAllocations(100, drafts)).toEqual({ error: null, total: 100, leftover: 0 });
    expect(willPost(drafts[0])).toBe(true);
  });

  it("partial allocation never counts as full", () => {
    const draft = { paymentId: "a", remaining: 100, amount: 60 };
    expect(validateAllocations(100, [draft]).error).toBeNull();
    expect(willPost(draft)).toBe(false);
  });

  it("blocks over-allocation of the line or of a claim, and empty/zero allocations", () => {
    expect(
      validateAllocations(100, [
        { paymentId: "a", remaining: 80, amount: 80 },
        { paymentId: "b", remaining: 50, amount: 30 },
      ]).error,
    ).toBe("exceedsLine");
    expect(validateAllocations(100, [{ paymentId: "a", remaining: 50, amount: 60 }]).error).toBe(
      "exceedsClaim",
    );
    expect(validateAllocations(100, []).error).toBe("empty");
    expect(validateAllocations(100, [{ paymentId: "a", remaining: 50, amount: 0 }]).error).toBe(
      "nonPositive",
    );
  });

  it("defaults a new allocation to what both sides still have open", () => {
    expect(defaultAllocationAmount(100, 0, 150)).toBe(100);
    expect(defaultAllocationAmount(100, 70, 50)).toBe(30);
    expect(defaultAllocationAmount(100, 100, 50)).toBe(0);
  });
});

describe("suggestion presentation", () => {
  it("one-click confirm only for an unambiguous, strong, amount-matching suggestion", () => {
    expect(canQuickConfirm(result(false), candidate({}))).toBe(true);
    expect(canQuickConfirm(result(true), candidate({}))).toBe(false);
    expect(canQuickConfirm(result(false), candidate({ strength: "MEDIUM" }))).toBe(false);
    expect(canQuickConfirm(result(false), candidate({ amountMatches: false }))).toBe(false);
  });

  it("hides the implied currency reason chip", () => {
    expect(
      visibleReasons([
        { signal: "ORDER", detail: "x" },
        { signal: "CURRENCY", detail: "SAR" },
      ]).map((reason) => reason.signal),
    ).toEqual(["ORDER"]);
  });

  it("reports missing required mapping fields", () => {
    expect(missingRequiredFields({ columns: { amount: "A" } })).toEqual([
      "transactionDate",
      "currency",
    ]);
    expect(
      missingRequiredFields({
        columns: { amount: "A", transactionDate: "D" },
        defaultCurrencyCode: "SAR",
      }),
    ).toEqual([]);
  });
});
