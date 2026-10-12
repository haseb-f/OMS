import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { unappliedPostingConfirmation, useVoucherAmount } from "./use-voucher-amount";

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;
const money = (value: number) => value.toFixed(2);

describe("useVoucherAmount (R18)", () => {
  it("a proposed amount follows the allocation lines — the owner's 200,000 → 100,000 case", () => {
    const { result } = renderHook(() => useVoucherAmount());
    act(() => result.current.proposeAmount(200_000));
    act(() => result.current.syncToAllocations([{ allocatedAmount: 100_000 }]));
    expect(result.current.amount).toBe(100_000);
  });

  it("a typed amount is the user's: allocation edits never change it", () => {
    const { result } = renderHook(() => useVoucherAmount());
    act(() => result.current.proposeAmount(200_000));
    act(() => result.current.setAmount(150_000));
    act(() => result.current.syncToAllocations([{ allocatedAmount: 100_000 }]));
    expect(result.current.amount).toBe(150_000);
  });

  it("sums several lines to cents", () => {
    const { result } = renderHook(() => useVoucherAmount());
    act(() => result.current.proposeAmount(1));
    act(() =>
      result.current.syncToAllocations([{ allocatedAmount: 0.1 }, { allocatedAmount: 0.2 }]),
    );
    expect(result.current.amount).toBe(0.3);
  });
});

describe("unappliedPostingConfirmation (R18)", () => {
  it("asks before posting money left unapplied while invoices are open", () => {
    const confirmation = unappliedPostingConfirmation(
      { amount: 200_000, allocatedTotal: 100_000, hasOpenInvoices: true, direction: "IN" },
      t as never,
      money,
    );
    expect(confirmation?.tone).toBe("warning");
    expect(confirmation?.description).toContain("receiptDescription");
    expect(confirmation?.description).toContain("100000.00");
    expect(confirmation?.confirmLabel).toContain("200000.00");
  });

  it("no dialog when fully applied, or for a plain advance with nothing to apply it to", () => {
    expect(
      unappliedPostingConfirmation(
        { amount: 100, allocatedTotal: 100, hasOpenInvoices: true, direction: "OUT" },
        t as never,
        money,
      ),
    ).toBeUndefined();
    expect(
      unappliedPostingConfirmation(
        { amount: 100, allocatedTotal: 0, hasOpenInvoices: false, direction: "IN" },
        t as never,
        money,
      ),
    ).toBeUndefined();
  });

  it("supplier payments use the payment wording", () => {
    expect(
      unappliedPostingConfirmation(
        { amount: 100, allocatedTotal: 40, hasOpenInvoices: true, direction: "OUT" },
        t as never,
        money,
      )?.description,
    ).toContain("paymentDescription");
  });
});
