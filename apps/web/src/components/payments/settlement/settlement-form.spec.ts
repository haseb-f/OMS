import { describe, expect, it } from "vitest";
import type { EligibleClaim } from "@/services/payment-settlements-service";
import {
  buildSettlementInput,
  inputSignature,
  selectionTotals,
  type SettlementFormState,
} from "./settlement-form";

function claim(id: string, remaining: string, currencyId = "sar"): EligibleClaim {
  return {
    id,
    paymentNumber: `PAY-${id}`,
    paymentDate: "2026-09-10",
    status: "VERIFIED",
    settlementStatus: "AWAITING_SETTLEMENT",
    referenceNumber: null,
    senderName: "Customer",
    currency: { id: currencyId, code: currencyId.toUpperCase() },
    amount: remaining,
    settledAmount: "0.00",
    remainingAmount: remaining,
    storeOrder: null,
    customer: null,
    receipt: null,
  };
}

const form: SettlementFormState = {
  receivedAmount: "4500",
  receivedCurrencyId: "sar",
  receivingAccountId: "bank",
  settlementDate: "2026-09-15",
  providerReference: " PAYOUT-1 ",
  feeAmount: "",
  notes: "",
  partialAmounts: {},
};

describe("settlement form", () => {
  it("totals the remaining amount and flags mixed currencies", () => {
    expect(selectionTotals([claim("a", "0.10"), claim("b", "0.20")])).toMatchObject({
      count: 2,
      remaining: 0.3,
      mixedCurrency: false,
      currency: { id: "sar" },
    });
    expect(selectionTotals([claim("a", "1"), claim("b", "1", "usd")]).mixedCurrency).toBe(true);
  });

  it("sends partial amounts only when they differ from the remainder, and no fee for same currency", () => {
    const input = buildSettlementInput("m", [claim("a", "500.00"), claim("b", "500.00")], {
      ...form,
      feeAmount: "10",
      partialAmounts: { a: "200", b: "500" },
    });
    expect(input).toMatchObject({
      claims: [{ paymentId: "a", amount: 200 }, { paymentId: "b" }],
      receivedAmount: 4500,
      providerReference: "PAYOUT-1",
      feeAmount: undefined,
    });
  });

  it("sends the commission for a cross-currency payout", () => {
    const input = buildSettlementInput("m", [claim("a", "500.00")], {
      ...form,
      receivedCurrencyId: "egp",
      feeAmount: "25.5",
    });
    expect(input?.feeAmount).toBe(25.5);
  });

  it("returns null until the required fields are present; the signature tracks input changes", () => {
    expect(
      buildSettlementInput("m", [claim("a", "1")], { ...form, receivingAccountId: "" }),
    ).toBeNull();
    expect(
      buildSettlementInput("m", [claim("a", "1")], { ...form, receivedAmount: "0" }),
    ).toBeNull();
    const a = buildSettlementInput("m", [claim("a", "1")], form);
    const b = buildSettlementInput("m", [claim("a", "1")], { ...form, receivedAmount: "4400" });
    expect(inputSignature(a)).not.toBe(inputSignature(b));
    expect(inputSignature(null)).toBe("");
  });
});
