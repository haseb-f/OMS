// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatAmountParts,
  formatMoney,
  isZeroAmount,
  toDisplayNumber,
} from "./money";

describe("formatAmount", () => {
  it("groups with Latin digits and fixed decimals", () => {
    expect(formatAmount(1234567.5)).toBe("1,234,567.50");
    expect(formatAmount("1000")).toBe("1,000.00");
    expect(formatAmount(1234.5678, { decimals: 3 })).toBe("1,234.568");
  });

  it("never uses Arabic-Indic digits, whatever the runtime locale", () => {
    const text = formatAmount(9876543.21, { currency: "EGP" });
    expect(text).toBe("9,876,543.21 EGP");
    expect(/[٠-٩۰-۹]/.test(text)).toBe(false);
  });

  it("writes negatives as minus or parentheses — never a Dr/Cr suffix", () => {
    expect(formatAmount(-1234.5)).toBe("-1,234.50");
    expect(formatAmount(-1234.5, { negative: "parens" })).toBe("(1,234.50)");
    expect(formatAmount(1234.5, { negative: "parens" })).toBe("1,234.50");
    expect(formatAmount(1234.5)).toBe("1,234.50");
  });

  it("writes zero as a dash, 0.00 or nothing — and never -0.00", () => {
    expect(formatAmount(0, { zero: "dash" })).toBe("—");
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(0, { zero: "blank" })).toBe("");
    expect(formatAmount(-0.004)).toBe("0.00");
    expect(formatAmount(-0.004, { zero: "dash" })).toBe("—");
    expect(formatAmount(0, { zero: "dash", currency: "EGP" })).toBe("—");
    expect(formatAmount(0, { currency: "EGP" })).toBe("0.00 EGP");
  });

  it("rounds half away from zero at the requested precision", () => {
    expect(formatAmount(1.005)).toBe(formatAmount(1.005)); // stable
    expect(formatAmount(2.345)).toBe("2.35");
    expect(formatAmount(-2.345)).toBe("-2.35");
    expect(formatAmount(0.005)).toBe("0.01");
    expect(isZeroAmount(0.0049)).toBe(true);
    expect(isZeroAmount(0.005)).toBe(false);
  });

  it("writes a missing value as a dash (or blank) — never a fake 0.00", () => {
    expect(formatAmount(null)).toBe("—");
    expect(formatAmount(undefined)).toBe("—");
    expect(formatAmount("")).toBe("—");
    expect(formatAmount("abc")).toBe("—");
    expect(formatAmount(Number.NaN)).toBe("—");
    expect(formatAmount(null, { currency: "EGP" })).toBe("—");
    expect(formatAmount(null, { missing: "blank" })).toBe("");
    // A genuine zero is still a zero.
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount("0")).toBe("0.00");
  });

  it("keeps arithmetic coercion for isZeroAmount, display coercion for formatting", () => {
    expect(isZeroAmount(null)).toBe(true);
    expect(toDisplayNumber(null)).toBeNull();
    expect(toDisplayNumber(" ")).toBeNull();
    expect(toDisplayNumber("12.5")).toBe(12.5);
    expect(toDisplayNumber(0)).toBe(0);
  });

  it("exposes the same text in parts (figure, currency, flags)", () => {
    expect(formatAmountParts(-2500, { currency: "EGP" })).toEqual({
      figure: "-2,500.00",
      currency: "EGP",
      isZero: false,
      isNegative: true,
      isMissing: false,
    });
    expect(formatAmountParts(null, { currency: "EGP" })).toEqual({
      figure: "—",
      currency: "",
      isZero: false,
      isNegative: false,
      isMissing: true,
    });
  });
});

describe("formatMoney (general display) keeps its contract", () => {
  it("formats en-US with an optional currency suffix", () => {
    expect(formatMoney(1234.5)).toBe("1,234.50");
    expect(formatMoney("-99.9", "USD")).toBe("-99.90 USD");
    expect(formatMoney(0, "EGP")).toBe("0.00 EGP");
    expect(formatMoney("not a number")).toBe("—");
    expect(formatMoney(null, "EGP")).toBe("—");
  });
});
