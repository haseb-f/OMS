import { describe, expect, it } from "vitest";
import {
  choiceFits,
  impliedChoice,
  isSubmitBlocked,
  panelMode,
  phoneMatchRecords,
  requiresChoice,
  resolutionFor,
  type DuplicatePanelState,
} from "@/config/orders/duplicate-panel";
import type { DuplicateCheckResult } from "@/services/order-duplicates-service";

const customer = { id: "c1", name: "Ahmed Salem", phoneMasked: "+9665•••••567" };

const phoneResult = (alternatives?: (typeof customer)[]): DuplicateCheckResult => ({
  kind: "PHONE",
  crossScope: false,
  customer,
  orders: [],
  otherOrdersCount: 0,
  ...(alternatives ? { alternatives } : {}),
});

const stateOf = (
  result: DuplicateCheckResult,
  choice: DuplicatePanelState["choice"] = null,
): DuplicatePanelState => ({ status: "ready", key: "k", result, choice });

describe("R11 — known customer (no order yet)", () => {
  const known: DuplicateCheckResult = {
    kind: "KNOWN",
    customer: { nameMasked: "Ah••• Sa•••", phoneMasked: "+9665•••••567" },
  };

  it("is shown but never blocks saving (nothing to answer)", () => {
    expect(panelMode(known)).toBe("known");
    expect(requiresChoice(known)).toBe(false);
    expect(isSubmitBlocked(stateOf(known), "k")).toBe(false);
    expect(resolutionFor(stateOf(known))).toBeUndefined();
  });
});

describe("R11 — one number on several customer records", () => {
  const other = { id: "c2", name: "Ahmed S.", phoneMasked: "+9665•••••567" };

  it("lists the shown customer first, then the other records", () => {
    expect(phoneMatchRecords(phoneResult([other])).map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(phoneMatchRecords(phoneResult())).toHaveLength(1);
    expect(phoneMatchRecords({ kind: "NONE" })).toEqual([]);
  });

  it("a choice must name one of the records — and it is sent with the customer id", () => {
    const result = phoneResult([other]);
    expect(choiceFits(result, { kind: "NEW_ORDER", customerId: "c2" })).toBe(true);
    expect(choiceFits(result, { kind: "NEW_ORDER", customerId: "c3" })).toBe(false);
    expect(resolutionFor(stateOf(result, { kind: "NEW_ORDER", customerId: "c2" }))).toEqual({
      decision: "INTENTIONAL_NEW_ORDER",
      customerId: "c2",
    });
  });

  it("an unanswered match blocks until a record is chosen", () => {
    const result = phoneResult([other]);
    expect(isSubmitBlocked(stateOf(result), "k")).toBe(true);
    expect(isSubmitBlocked(stateOf(result, { kind: "NEW_ORDER", customerId: "c1" }), "k")).toBe(
      false,
    );
  });

  it("a customer picked explicitly answers its own match, including an alternative record", () => {
    const result = phoneResult([other]);
    expect(impliedChoice(result, "c2")).toEqual({ kind: "NEW_ORDER", customerId: "c2" });
    expect(impliedChoice(result, "zzz")).toBeNull();
  });
});
