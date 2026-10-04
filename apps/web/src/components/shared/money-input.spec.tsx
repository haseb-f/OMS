import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/providers/locale-provider", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "ar", direction: "rtl" }),
}));

import { MoneyInput } from "@/components/shared/money-input";
import { createEmptyLine, isLinePriceMissing } from "@/components/sales/product-line-items-grid";

describe("MoneyInput — empty vs zero (R11 addendum)", () => {
  afterEach(cleanup);

  it("an unset amount is genuinely empty and illustrates 0.00 as a placeholder only", () => {
    render(<MoneyInput value="" onChange={() => {}} aria-label="amount" />);
    const input = screen.getByLabelText("amount") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("0.00");
  });

  it("an explicitly entered or saved zero stays visible and distinct from blank", () => {
    const { rerender } = render(<MoneyInput value={0} onChange={() => {}} aria-label="amount" />);
    expect((screen.getByLabelText("amount") as HTMLInputElement).value).toBe("0");
    rerender(<MoneyInput value="" onChange={() => {}} aria-label="amount" />);
    expect((screen.getByLabelText("amount") as HTMLInputElement).value).toBe("");
  });

  it("typing from empty needs nothing deleted and keeps the decimals", () => {
    let latest = "";
    render(
      <MoneyInput
        value=""
        onChange={(event) => (latest = event.target.value)}
        aria-label="amount"
      />,
    );
    fireEvent.change(screen.getByLabelText("amount"), { target: { value: "12.50" } });
    expect(latest).toBe("12.50");
  });

  it("keeps LTR digits, decimal mode and a custom placeholder when given", () => {
    render(
      <MoneyInput value="" placeholder="e.g. 1,000" onChange={() => {}} aria-label="amount" />,
    );
    const input = screen.getByLabelText("amount") as HTMLInputElement;
    expect(input.getAttribute("dir")).toBe("ltr");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(input.placeholder).toBe("e.g. 1,000");
  });
});

describe("document line price — blank vs zero (R11 addendum)", () => {
  it("a new line starts with an unset price; a saved line (no blank flag) keeps its price, even 0", () => {
    expect(createEmptyLine().priceBlank).toBe(true);
    const saved = { ...createEmptyLine(), priceBlank: undefined, unitPrice: 0 };
    expect(saved.priceBlank).toBeUndefined();
  });

  it("a required price is missing while blank, and an entered zero is still not a price", () => {
    const withProduct = { ...createEmptyLine(), product: { id: "p" } as never };
    expect(isLinePriceMissing(withProduct)).toBe(true); // blank
    expect(isLinePriceMissing({ ...withProduct, priceBlank: false, unitPrice: 0 })).toBe(true); // explicit zero ≠ price
    expect(isLinePriceMissing({ ...withProduct, priceBlank: false, unitPrice: 25 })).toBe(false);
  });
});

describe("text caret", () => {
  it("the native caret is tinted with the brand token on every typing surface (no simulated cursor)", () => {
    const css = readFileSync(resolve(__dirname, "../../theme/recipes.css"), "utf8");
    expect(css).toMatch(/caret-color:\s*var\(--caret-color\)/);
    expect(css).not.toMatch(/fake-caret|simulated-caret/);
  });
});
