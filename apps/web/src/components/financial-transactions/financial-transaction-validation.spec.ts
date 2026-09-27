import { describe, expect, it } from "vitest";
import {
  financialTransactionErrorKeys,
  translateFieldErrors,
} from "./financial-transaction-validation";

const valid = { hasParty: true, amount: 100, allocatedTotal: 60, receivingAccountId: null };

describe("financialTransactionErrorKeys", () => {
  it("accepts a partially allocated draft", () => {
    expect(financialTransactionErrorKeys(valid)).toBeNull();
  });

  it("reports every problem under its own field at once", () => {
    expect(
      financialTransactionErrorKeys({
        hasParty: false,
        amount: 0,
        allocatedTotal: 0,
        receivingAccountId: null,
        forPosting: true,
      }),
    ).toEqual({
      party: "financialTransactions.validation.partyRequired",
      amount: "financialTransactions.validation.amountRequired",
      receivingAccount: "financialTransactions.validation.receivingAccountRequired",
    });
  });

  it("flags allocations above the amount, tolerating rounding", () => {
    expect(financialTransactionErrorKeys({ ...valid, allocatedTotal: 100.004 })).toBeNull();
    expect(financialTransactionErrorKeys({ ...valid, allocatedTotal: 100.5 })).toEqual({
      allocations: "financialTransactions.validation.allocationExceedsAmount",
    });
  });

  it("requires refunds to be fully allocated", () => {
    expect(financialTransactionErrorKeys({ ...valid, allocationMode: "exact" })).toEqual({
      allocations: "financialTransactions.validation.allocationMustEqualAmount",
    });
    expect(
      financialTransactionErrorKeys({ ...valid, allocatedTotal: 100, allocationMode: "exact" }),
    ).toBeNull();
  });

  it("only requires the receiving account when posting", () => {
    expect(financialTransactionErrorKeys({ ...valid, forPosting: true })).toEqual({
      receivingAccount: "financialTransactions.validation.receivingAccountRequired",
    });
    expect(
      financialTransactionErrorKeys({ ...valid, forPosting: true, receivingAccountId: "acc" }),
    ).toBeNull();
  });
});

describe("translateFieldErrors", () => {
  it("resolves keys and passes null through as undefined", () => {
    expect(translateFieldErrors(null, (key) => key)).toBeUndefined();
    expect(
      translateFieldErrors(
        { amount: "financialTransactions.validation.amountRequired" },
        (key) => `t:${key}`,
      ),
    ).toEqual({ amount: "t:financialTransactions.validation.amountRequired" });
  });
});
