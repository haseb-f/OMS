import { describe, expect, it } from "vitest";
import {
  buildExpenseVoucherPayload,
  expensePostingState,
  expenseVoucherErrorKeys,
  openInvoicesSummary,
  payInvoiceHref,
  type ExpenseVoucherFormState,
} from "./expense-voucher";

const filled: ExpenseVoucherFormState = {
  transactionDate: new Date("2026-10-05T09:00:00.000Z"),
  expenseAccountId: "acc-1",
  description: "  Cleaning supplies ",
  amount: 150,
  currencyId: null,
  receivingAccountId: "bank-1",
  paymentSourceId: null,
  partnerId: null,
  costCenterId: "cc-1",
  projectId: null,
  referenceNumber: "",
  notes: "",
};

describe("expenseVoucherErrorKeys", () => {
  it("accepts a complete voucher for saving and posting", () => {
    expect(expenseVoucherErrorKeys(filled, false)).toBeNull();
    expect(expenseVoucherErrorKeys(filled, true)).toBeNull();
  });

  it("requires the expense account and a positive amount, under their own fields", () => {
    expect(
      expenseVoucherErrorKeys({ ...filled, expenseAccountId: null, amount: 0 }, false),
    ).toEqual({
      party: "expenseVouchers.validation.expenseAccountRequired",
      amount: "financialTransactions.validation.amountRequired",
    });
  });

  it("a draft may omit the paid-from account; posting may not", () => {
    const noBank = { ...filled, receivingAccountId: null };
    expect(expenseVoucherErrorKeys(noBank, false)).toBeNull();
    expect(expenseVoucherErrorKeys(noBank, true)).toEqual({
      receivingAccount: "financialTransactions.validation.receivingAccountRequired",
    });
  });
});

describe("buildExpenseVoucherPayload", () => {
  it("omits empty optional links on create and trims text", () => {
    const payload = buildExpenseVoucherPayload(filled, "create");
    expect(payload).toEqual({
      expenseAccountId: "acc-1",
      transactionDate: "2026-10-05T09:00:00.000Z",
      amount: 150,
      currencyId: undefined,
      receivingAccountId: "bank-1",
      paymentSourceId: undefined,
      partnerId: undefined,
      costCenterId: "cc-1",
      projectId: undefined,
      description: "Cleaning supplies",
      referenceNumber: undefined,
      notes: undefined,
    });
    expect(payload).not.toHaveProperty("allocations");
  });

  it("sends null to clear a counterparty / cost center / project on edit", () => {
    const payload = buildExpenseVoucherPayload({ ...filled, costCenterId: null }, "update");
    expect(payload.partnerId).toBeNull();
    expect(payload.costCenterId).toBeNull();
    expect(payload.projectId).toBeNull();
  });
});

describe("posting state and helpers", () => {
  it("maps the voucher status to its posting state", () => {
    expect(expensePostingState("DRAFT")).toBe("notPosted");
    expect(expensePostingState("CONFIRMED")).toBe("posted");
    expect(expensePostingState("CANCELLED")).toBe("reversed");
  });

  it("summarizes open invoices and links the supplier payment editor", () => {
    const rows = [
      { remainingBalance: 100.1, invoiceId: "a" },
      { remainingBalance: 50.2, invoiceId: "b" },
    ] as unknown as Parameters<typeof openInvoicesSummary>[0];
    expect(openInvoicesSummary(rows)).toEqual({ count: 2, remaining: 150.3 });
    expect(payInvoiceHref("sup-1", "inv-9")).toBe(
      "/purchasing/payments/new?partnerId=sup-1&invoiceId=inv-9",
    );
  });
});
