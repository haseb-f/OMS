import { describe, expect, it } from "vitest";
import { normalizeNumericText, parseNumericText, sanitizeNumericText } from "./numeric-input";

describe("numeric input parser (R22 §3)", () => {
  it.each([
    ["1,234.50", "1234.50", 1234.5],
    ["١٢٣٤٫٥", "1234.5", 1234.5],
    ["١٬٢٣٤٫٥٠", "1234.50", 1234.5],
    ["۱۲۳", "123", 123],
    ["1 234.5", "1234.5", 1234.5],
    ["0", "0", 0],
    ["0.", "0.", 0],
    ["0.5", "0.5", 0.5],
    [".5", "0.5", 0.5],
    ["100.05", "100.05", 100.05],
    ["12.3.4", "12.34", 12.34],
    ["abc", "", null],
    ["", "", null],
  ])("«%s» → «%s» (%s)", (raw, canonical, value) => {
    expect(normalizeNumericText(raw)).toBe(canonical);
    expect(parseNumericText(raw)).toBe(value);
  });

  it("drops a minus unless negatives are allowed", () => {
    expect(normalizeNumericText("-50")).toBe("50");
    expect(normalizeNumericText("-50", { allowNegative: true })).toBe("-50");
    expect(parseNumericText("-", { allowNegative: true })).toBeNull();
  });

  it("keeps the typed characters an amount can contain while editing", () => {
    expect(sanitizeNumericText("1,234.5x")).toBe("1,234.5");
    expect(sanitizeNumericText("١٢٣٤٫٥")).toBe("١٢٣٤٫٥");
    expect(sanitizeNumericText("-5")).toBe("5");
    expect(sanitizeNumericText("-5", { allowNegative: true })).toBe("-5");
  });
});
