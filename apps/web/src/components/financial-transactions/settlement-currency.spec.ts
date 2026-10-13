import { describe, expect, it } from "vitest";
import type { OpenInvoiceRow } from "@/services/financial-transactions-service";
import {
  isOtherCurrency,
  planPayAllRemaining,
  resolveSettlementCurrency,
} from "./settlement-currency";
import { describeOpenInvoice } from "./open-invoices-table";
import {
  invoicePaymentExportFields,
  invoiceSurfaceTone,
} from "@/config/financial-transactions/status";

function open(
  invoiceId: string,
  remainingBalance: number,
  currencyId: string | null = "EGP-ID",
  allocatedTotal = 0,
): OpenInvoiceRow {
  return {
    invoiceId,
    invoiceNumber: `INV-${invoiceId}`,
    documentDate: "2026-10-13T00:00:00.000Z",
    currencyId,
    currencyCode: currencyId ? currencyId.replace("-ID", "") : null,
    grandTotal: remainingBalance + allocatedTotal,
    allocatedTotal,
    remainingBalance,
    paymentStatus: allocatedTotal > 0 ? "PARTIALLY_PAID" : "UNPAID",
  };
}

describe("settlement currency (R20)", () => {
  it("the saved voucher's currency wins; otherwise its first invoice's; nothing before a choice", () => {
    const invoices = [open("a", 100, "SAR-ID"), open("b", 50)];
    expect(
      resolveSettlementCurrency({ currencyId: "EGP-ID", currency: { code: "EGP" } }, [], invoices),
    ).toEqual({ currencyId: "EGP-ID", currencyCode: "EGP" });
    expect(resolveSettlementCurrency(null, [{ invoiceId: "a" }], invoices)).toEqual({
      currencyId: "SAR-ID",
      currencyCode: "SAR",
    });
    expect(resolveSettlementCurrency(null, [], invoices)).toBeNull();
  });

  it("an invoice in another currency is not allocatable", () => {
    const sar = { currencyId: "SAR-ID", currencyCode: "SAR" };
    expect(isOtherCurrency(open("a", 1, "EGP-ID"), sar)).toBe(true);
    expect(isOtherCurrency(open("a", 1, "SAR-ID"), sar)).toBe(false);
    expect(isOtherCurrency(open("a", 1, "EGP-ID"), null)).toBe(false);
  });

  it("pay all remaining: oldest first, one currency, capped by the unallocated money", () => {
    const invoices = [open("a", 100), open("b", 70, "SAR-ID"), open("c", 80)];
    const plan = planPayAllRemaining(
      invoices,
      [{ invoiceId: "a", allocatedAmount: 20 }],
      120,
      null,
    );
    expect(Object.fromEntries(plan)).toEqual({ a: 100, c: 40 });
  });
});

describe("open invoice figures (R20)", () => {
  it("draft voucher: paid before = confirmed payments, open = remaining, this voucher apart", () => {
    expect(describeOpenInvoice(open("a", 100_000, "EGP-ID", 100_000), 60_000, false)).toEqual({
      paidBefore: 100_000,
      openBefore: 100_000,
      thisVoucher: 60_000,
    });
  });

  it("confirmed voucher: its own line is taken out of the paid figure (total = paid before + open)", () => {
    // Invoice 200,000; this voucher confirmed 60,000, another one 40,000 → API: paid 100,000, remaining 100,000.
    expect(describeOpenInvoice(open("a", 100_000, "EGP-ID", 100_000), 60_000, true)).toEqual({
      paidBefore: 40_000,
      openBefore: 160_000,
      thisVoucher: 60_000,
    });
  });
});

describe("invoice payment display helpers (R20)", () => {
  it("a posted invoice's surface is its payment status; drafts and cancelled keep the document tone", () => {
    expect(invoiceSurfaceTone("CONFIRMED", "success", "UNPAID")).toBe("destructive");
    expect(invoiceSurfaceTone("CONFIRMED", "success", "PARTIALLY_PAID")).toBe("warning");
    expect(invoiceSurfaceTone("CONFIRMED", "success", "PAID")).toBe("success");
    expect(invoiceSurfaceTone("DRAFT", "neutral", "UNPAID")).toBe("neutral");
    expect(invoiceSurfaceTone("CANCELLED", "destructive", "CANCELLED")).toBe("destructive");
  });

  it("the export carries the payment status label and the paid / outstanding figures", () => {
    expect(
      invoicePaymentExportFields(
        { paymentStatus: "PARTIALLY_PAID", allocatedTotal: 100_000, remainingBalance: 100_000 },
        (key) => key,
      ),
    ).toEqual({
      paymentStatus: "financialTransactions.invoiceStatus.partiallyPaid",
      allocatedTotal: "100000",
      remainingBalance: "100000",
    });
  });
});
