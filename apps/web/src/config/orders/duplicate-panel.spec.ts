import { describe, expect, it } from "vitest";
import {
  choiceFits,
  duplicateCheckKey,
  impliedChoice,
  isSubmitBlocked,
  panelMode,
  primaryExistingOrder,
  resolutionFor,
  sortOrdersForPanel,
  type DuplicatePanelState,
} from "./duplicate-panel";
import type {
  DuplicateCheckResult,
  DuplicateOrderSummary,
} from "@/services/order-duplicates-service";

const order = (id: string, active: boolean, orderDate: string): DuplicateOrderSummary => ({
  id,
  orderNumber: `STO-${id}`,
  orderDate,
  active,
  paymentStatus: "PAYMENT_PENDING",
  declaredPaymentStatus: "UNPAID",
  fulfillmentStatus: null,
  total: 100,
  currencyCode: "SAR",
});

const phoneMatch: DuplicateCheckResult = {
  kind: "PHONE",
  crossScope: false,
  customer: { id: "c1", name: "Ahmed", phoneMasked: "+9665•••••567" },
  orders: [
    order("old-closed", false, "2026-01-01"),
    order("new-closed", false, "2026-05-01"),
    order("old-active", true, "2026-02-01"),
  ],
  otherOrdersCount: 1,
};
const crossScope: DuplicateCheckResult = { kind: "PHONE", crossScope: true };
const nameMatch: DuplicateCheckResult = {
  kind: "NAME",
  candidates: [
    { id: "n1", name: "أحمد", phoneMasked: null, orderCount: 2, lastOrderDate: "2026-03-01" },
  ],
};

const ready = (
  result: DuplicateCheckResult,
  choice: DuplicatePanelState["choice"] = null,
  key = "k",
): DuplicatePanelState => ({ status: "ready", key, result, choice });

describe("duplicateCheckKey", () => {
  it("is empty until a phone (8+ digits) or a name (3+ letters) exists", () => {
    expect(duplicateCheckKey({ phone: "0501", name: "Al" })).toBe("");
    expect(duplicateCheckKey({ phone: "+966 50 123 4567" })).not.toBe("");
    expect(duplicateCheckKey({ name: "Ali" })).not.toBe("");
  });

  it("ignores formatting and reads Arabic-Indic digits", () => {
    expect(duplicateCheckKey({ phone: "+966 50-123-4567", name: " Ali  Omar " })).toBe(
      duplicateCheckKey({ phone: "+٩٦٦٥٠١٢٣٤٥٦٧", name: "ali omar" }),
    );
  });

  it("changes with the phone country", () => {
    expect(duplicateCheckKey({ phone: "0501234567", countryId: "sa" })).not.toBe(
      duplicateCheckKey({ phone: "0501234567", countryId: "eg" }),
    );
  });
});

describe("panel modes and choices", () => {
  it("maps results to modes", () => {
    expect(panelMode(null)).toBe("none");
    expect(panelMode({ kind: "NONE" })).toBe("none");
    expect(panelMode(phoneMatch)).toBe("phone");
    expect(panelMode(crossScope)).toBe("crossScope");
    expect(panelMode(nameMatch)).toBe("name");
    expect(panelMode({ kind: "NAME", candidates: [] })).toBe("none");
  });

  it("accepts only answers that fit the current result", () => {
    expect(choiceFits(phoneMatch, { kind: "NEW_ORDER", customerId: "c1" })).toBe(true);
    expect(choiceFits(phoneMatch, { kind: "NEW_ORDER", customerId: "other" })).toBe(false);
    expect(choiceFits(phoneMatch, { kind: "DIFFERENT_CUSTOMER" })).toBe(false);
    expect(choiceFits(crossScope, { kind: "CONTINUE_WITH_REVIEW" })).toBe(true);
    expect(choiceFits(nameMatch, { kind: "SAME_CUSTOMER", customerId: "n1" })).toBe(true);
    expect(choiceFits(nameMatch, { kind: "SAME_CUSTOMER", customerId: "zz" })).toBe(false);
    expect(choiceFits(nameMatch, { kind: "DIFFERENT_CUSTOMER" })).toBe(true);
  });

  it("builds the API resolution", () => {
    expect(resolutionFor(ready(phoneMatch, { kind: "NEW_ORDER", customerId: "c1" }))).toEqual({
      decision: "INTENTIONAL_NEW_ORDER",
      customerId: "c1",
    });
    expect(resolutionFor(ready(crossScope, { kind: "CONTINUE_WITH_REVIEW" }))).toEqual({
      decision: "INTENTIONAL_NEW_ORDER",
    });
    expect(resolutionFor(ready(nameMatch, { kind: "SAME_CUSTOMER", customerId: "n1" }))).toEqual({
      decision: "USE_EXISTING_CUSTOMER",
      customerId: "n1",
    });
    expect(resolutionFor(ready(nameMatch, { kind: "DIFFERENT_CUSTOMER" }))).toEqual({
      decision: "DIFFERENT_CUSTOMER",
    });
    expect(resolutionFor(ready({ kind: "NONE" }))).toBeUndefined();
    // A stale answer (from an older result) is never sent.
    expect(
      resolutionFor(ready(nameMatch, { kind: "NEW_ORDER", customerId: "c1" })),
    ).toBeUndefined();
  });

  it("implies the choice for a customer the user already picked", () => {
    expect(impliedChoice(phoneMatch, "c1")).toEqual({ kind: "NEW_ORDER", customerId: "c1" });
    expect(impliedChoice(nameMatch, "n1")).toEqual({ kind: "SAME_CUSTOMER", customerId: "n1" });
    expect(impliedChoice(phoneMatch, "other")).toBeNull();
    expect(impliedChoice(crossScope, "c1")).toBeNull();
    expect(impliedChoice(phoneMatch, null)).toBeNull();
  });
});

describe("isSubmitBlocked", () => {
  it("never blocks when there is nothing to check", () => {
    expect(isSubmitBlocked({ status: "idle", key: "", result: null, choice: null }, "")).toBe(
      false,
    );
  });

  it("waits for the check of the current input", () => {
    expect(isSubmitBlocked({ status: "checking", key: "k", result: null, choice: null }, "k")).toBe(
      true,
    );
    expect(isSubmitBlocked(ready({ kind: "NONE" }, null, "old"), "k")).toBe(true);
  });

  it("blocks an unanswered match and releases once answered", () => {
    expect(isSubmitBlocked(ready(phoneMatch), "k")).toBe(true);
    expect(isSubmitBlocked(ready(phoneMatch, { kind: "NEW_ORDER", customerId: "c1" }), "k")).toBe(
      false,
    );
    expect(isSubmitBlocked(ready(nameMatch), "k")).toBe(true);
    expect(isSubmitBlocked(ready(nameMatch, { kind: "DIFFERENT_CUSTOMER" }), "k")).toBe(false);
    expect(isSubmitBlocked(ready(crossScope, { kind: "CONTINUE_WITH_REVIEW" }), "k")).toBe(false);
    expect(isSubmitBlocked(ready({ kind: "NONE" }), "k")).toBe(false);
  });

  it("does not block on a failed check (the server still enforces it)", () => {
    expect(isSubmitBlocked({ status: "failed", key: "k", result: null, choice: null }, "k")).toBe(
      false,
    );
  });
});

describe("existing orders", () => {
  it("lists active orders first, newest first", () => {
    expect(
      sortOrdersForPanel((phoneMatch as { orders: DuplicateOrderSummary[] }).orders).map(
        (row) => row.id,
      ),
    ).toEqual(["old-active", "new-closed", "old-closed"]);
    expect(primaryExistingOrder(phoneMatch)?.id).toBe("old-active");
    expect(primaryExistingOrder(crossScope)).toBeNull();
  });
});
