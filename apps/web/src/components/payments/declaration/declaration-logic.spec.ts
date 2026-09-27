import { describe, expect, it } from "vitest";
import { ApiError } from "@/services/api-client";
import {
  buildDeclarationPayload,
  declarationAmount,
  declarationFailureToast,
  emptyDeclaration,
  projectedDeclaredStatus,
  remainingDeclarable,
  validateDeclaration,
  type DeclarationFormState,
} from "./declaration-logic";
import {
  financeVerificationState,
  isPrepaidFulfillmentAllowed,
  settlementState,
} from "./declaration-status";

const today = "2026-09-27";

function state(patch: Partial<DeclarationFormState> = {}): DeclarationFormState {
  return {
    ...emptyDeclaration("FULL", new Date("2026-09-27T10:00:00")),
    paymentMethodId: "m-1",
    ...patch,
  };
}

describe("payment declaration form rules", () => {
  it("FULL declares the whole remainder and never sends an amount", () => {
    const value = state({ kind: "FULL", amount: "5" });
    expect(declarationAmount(value, 250)).toBe(250);
    expect(buildDeclarationPayload(value, "c-1")).toMatchObject({
      kind: "FULL",
      amount: undefined,
      paymentMethodId: "m-1",
      currencyId: "c-1",
    });
  });

  it("PARTIAL requires a positive amount within the remainder", () => {
    const ctx = { total: 100, remaining: 60, today };
    expect(validateDeclaration(state({ kind: "PARTIAL", amount: "" }), ctx)).toBe("amountRequired");
    expect(validateDeclaration(state({ kind: "PARTIAL", amount: "60.01" }), ctx)).toBe(
      "amountExceeds",
    );
    expect(validateDeclaration(state({ kind: "PARTIAL", amount: "60" }), ctx)).toBeNull();
    expect(
      buildDeclarationPayload(state({ kind: "PARTIAL", amount: "12.345" }), "c"),
    ).toMatchObject({ kind: "PARTIAL", amount: 12.35 });
  });

  it("a paid declaration needs a method and a non-future date", () => {
    const ctx = { total: 100, remaining: 100, today };
    expect(validateDeclaration(state({ paymentMethodId: "" }), ctx)).toBe("methodRequired");
    expect(validateDeclaration(state({ paymentDate: "" }), ctx)).toBe("dateRequired");
    expect(validateDeclaration(state({ paymentDate: "2026-09-28" }), ctx)).toBe("dateFuture");
  });

  it("blocks declaring on a zero-total or fully declared order; UNPAID always valid", () => {
    expect(validateDeclaration(state(), { total: 0, remaining: 0, today })).toBe("zeroTotal");
    expect(validateDeclaration(state(), { total: 100, remaining: 0, today })).toBe(
      "nothingRemaining",
    );
    expect(
      validateDeclaration(state({ kind: "UNPAID" }), { total: 100, remaining: 0, today }),
    ).toBeNull();
    expect(buildDeclarationPayload(state({ kind: "UNPAID" }), "c")).toEqual({ kind: "UNPAID" });
  });

  it("remaining and projected status never treat a partial as full", () => {
    expect(remainingDeclarable(100, 40)).toBe(60);
    expect(remainingDeclarable(100, 120)).toBe(0);
    expect(projectedDeclaredStatus(100, 0, 40)).toBe("PARTIALLY_PAID");
    expect(projectedDeclaredStatus(100, 40, 60)).toBe("PAID");
    expect(projectedDeclaredStatus(100, 0, 0)).toBe("UNPAID");
  });
});

describe("payment status separation", () => {
  it("prepaid gate: declared PAID or verified; partial never; COD always", () => {
    expect(
      isPrepaidFulfillmentAllowed({ paymentType: "PREPAID", declaredPaymentStatus: "PAID" }),
    ).toBe(true);
    expect(
      isPrepaidFulfillmentAllowed({
        paymentType: "PREPAID",
        declaredPaymentStatus: "PARTIALLY_PAID",
        paymentStatus: "PAYMENT_REVIEW",
      }),
    ).toBe(false);
    expect(
      isPrepaidFulfillmentAllowed({
        paymentType: "PREPAID",
        declaredPaymentStatus: "UNPAID",
        paymentStatus: "FULLY_PAID_RECONCILED",
      }),
    ).toBe(true);
    expect(
      isPrepaidFulfillmentAllowed({
        paymentType: "CASH_ON_DELIVERY",
        declaredPaymentStatus: "UNPAID",
      }),
    ).toBe(true);
  });

  it("finance verification and settlement are derived separately from the declaration", () => {
    expect(financeVerificationState([])).toBe("NONE");
    expect(financeVerificationState([{ status: "PENDING" }])).toBe("AWAITING");
    expect(financeVerificationState([{ status: "VERIFIED" }, { status: "PENDING" }])).toBe(
      "PARTIAL",
    );
    expect(financeVerificationState([{ status: "VERIFIED" }], "FULLY_PAID_RECONCILED")).toBe(
      "VERIFIED",
    );
    expect(financeVerificationState([{ status: "DISPUTED" }])).toBe("DISPUTED");
    expect(settlementState([{ status: "VERIFIED", settlementStatus: "NOT_APPLICABLE" }])).toBe(
      "NOT_APPLICABLE",
    );
    expect(
      settlementState([
        { status: "VERIFIED", settlementStatus: "AWAITING_SETTLEMENT" },
        { status: "VERIFIED", settlementStatus: "SETTLED" },
      ]),
    ).toBe("PARTIALLY_SETTLED");
  });
});

describe("declarationFailureToast (FIX-QA OBS1)", () => {
  const labels = { permissionTitle: "لا توجد صلاحية", failed: "تعذر الحفظ" };

  it("a 403 with an explanation keeps the headline and shows the reason", () => {
    const reason =
      "Changing the payment declaration now is a correction that requires the store-orders.manage or sales.receipts.confirm permission.";
    expect(declarationFailureToast(new ApiError(403, reason, "PERMISSION_ERROR"), labels)).toEqual({
      title: labels.permissionTitle,
      description: reason,
    });
  });

  it("a generic 403 shows only the generic text", () => {
    expect(
      declarationFailureToast(
        new ApiError(403, labels.permissionTitle, "PERMISSION_ERROR"),
        labels,
      ),
    ).toEqual({ title: labels.permissionTitle });
  });

  it("other API errors show their message; unknown errors the fallback", () => {
    expect(
      declarationFailureToast(new ApiError(409, "Conflict here", "DUPLICATE"), labels),
    ).toEqual({ title: "Conflict here" });
    expect(declarationFailureToast(new Error("boom"), labels)).toEqual({ title: labels.failed });
  });
});
