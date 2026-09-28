import { describe, expect, it } from "vitest";
import { resolveSlipCollection, slipLineAmount, slipOrderTotal } from "./package-slip-print";

const allowed = { allowed: true, basis: "DECLARED_PAID" as const };
const verified = { allowed: true, basis: "VERIFIED_PAID" as const };
const blocked = { allowed: false, basis: null };
const cod = { allowed: true, basis: "COD" as const };

describe("resolveSlipCollection (package slip collection instruction)", () => {
  it("COD with nothing declared collects the order total", () => {
    expect(
      resolveSlipCollection({ paymentType: "CASH_ON_DELIVERY", declaredAmount: "0" }, 450, cod),
    ).toEqual({ kind: "collect", amount: 450, orderTotal: 450, declaredPaid: 0 });
  });

  it("COD with a declared deposit collects only the rest", () => {
    expect(
      resolveSlipCollection({ paymentType: "CASH_ON_DELIVERY", declaredAmount: "100.5" }, 450, cod),
    ).toEqual({ kind: "collect", amount: 349.5, orderTotal: 450, declaredPaid: 100.5 });
  });

  it("COD fully declared (or over-declared) needs no collection", () => {
    expect(
      resolveSlipCollection({ paymentType: "CASH_ON_DELIVERY", declaredAmount: "450" }, 450, cod),
    ).toEqual({ kind: "none", basis: "COD_SETTLED" });
    expect(
      resolveSlipCollection({ paymentType: "CASH_ON_DELIVERY", declaredAmount: "500" }, 450, cod),
    ).toEqual({ kind: "none", basis: "COD_SETTLED" });
  });

  it("COD fully covered: declared basis unless Finance verified the payment", () => {
    expect(
      resolveSlipCollection(
        {
          paymentType: "CASH_ON_DELIVERY",
          declaredAmount: "450",
          paymentStatus: "PAYMENT_PENDING",
        },
        450,
        cod,
      ),
    ).toEqual({ kind: "none", basis: "COD_SETTLED" });
    expect(
      resolveSlipCollection(
        {
          paymentType: "CASH_ON_DELIVERY",
          declaredAmount: "450",
          paymentStatus: "FULLY_PAID_RECONCILED",
        },
        450,
        cod,
      ),
    ).toEqual({ kind: "none", basis: "VERIFIED_PAID" });
    // A verified status never waives an amount still due.
    expect(
      resolveSlipCollection(
        { paymentType: "CASH_ON_DELIVERY", declaredAmount: "100", paymentStatus: "OVERPAID" },
        450,
        cod,
      ),
    ).toEqual({ kind: "collect", amount: 350, orderTotal: 450, declaredPaid: 100 });
  });

  it("prepaid, declared paid in full: no collection, declared basis (not reconciled)", () => {
    expect(
      resolveSlipCollection({ paymentType: "PREPAID", declaredAmount: "450" }, 450, allowed),
    ).toEqual({ kind: "none", basis: "DECLARED_PAID" });
  });

  it("prepaid, Finance verified: no collection, verified basis", () => {
    expect(
      resolveSlipCollection({ paymentType: "PREPAID", declaredAmount: "0" }, 450, verified),
    ).toEqual({ kind: "none", basis: "VERIFIED_PAID" });
  });

  it("prepaid unpaid or partial (gate closed): hold, never an invented amount", () => {
    expect(
      resolveSlipCollection({ paymentType: "PREPAID", declaredAmount: "0" }, 450, blocked),
    ).toEqual({ kind: "hold" });
    expect(
      resolveSlipCollection({ paymentType: "PREPAID", declaredAmount: "200" }, 450, blocked),
    ).toEqual({ kind: "hold" });
  });

  it("a missing declared amount counts as zero", () => {
    expect(
      resolveSlipCollection(
        { paymentType: "CASH_ON_DELIVERY", declaredAmount: undefined },
        99.99,
        cod,
      ),
    ).toEqual({ kind: "collect", amount: 99.99, orderTotal: 99.99, declaredPaid: 0 });
  });
});

describe("slipLineAmount", () => {
  it("uses the agreed amount, independent of quantity", () => {
    expect(slipLineAmount({ quantity: 3, unitPrice: "10", agreedAmount: "25" })).toBe(25);
  });
  it("falls back to qty × unit price for legacy rows", () => {
    expect(slipLineAmount({ quantity: 3, unitPrice: "10", agreedAmount: null })).toBe(30);
  });
});

describe("slipOrderTotal", () => {
  const items = [
    { quantity: 2, unitPrice: "300", agreedAmount: "600" },
    { quantity: 1, unitPrice: "400", agreedAmount: "400" },
  ];
  it("legacy / company orders pay the sum of their lines", () => {
    expect(slipOrderTotal({ payableTotal: null, items })).toBe(1000);
    expect(slipOrderTotal({ items })).toBe(1000);
  });
  it("agent orders pay the stored payable total (merchandise + shipping + service)", () => {
    expect(slipOrderTotal({ payableTotal: "1150.00", items })).toBe(1150);
  });
  it("an agent COD slip collects the payable total, not just the lines", () => {
    const total = slipOrderTotal({ payableTotal: "1150.00", items });
    expect(
      resolveSlipCollection({ paymentType: "CASH_ON_DELIVERY", declaredAmount: "0" }, total, cod),
    ).toEqual({ kind: "collect", amount: 1150, orderTotal: 1150, declaredPaid: 0 });
  });
});
