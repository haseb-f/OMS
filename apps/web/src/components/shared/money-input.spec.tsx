import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";

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

describe("MoneyInput — text entry (R22 §3)", () => {
  afterEach(cleanup);

  it("is a text field with a decimal keyboard, never type=number", () => {
    render(<MoneyInput value="" onChange={() => {}} aria-label="amount" />);
    const input = screen.getByLabelText("amount") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.getAttribute("inputmode")).toBe("decimal");
  });

  it("hands legacy onChange callers the canonical text and number", () => {
    let text = "";
    let asNumber = 0;
    render(
      <MoneyInput
        value=""
        onChange={(event) => {
          text = event.target.value;
          asNumber = event.target.valueAsNumber;
        }}
        aria-label="amount"
      />,
    );
    fireEvent.change(screen.getByLabelText("amount"), { target: { value: "١٬٢٣٤٫٥٠" } });
    expect(text).toBe("1234.50");
    expect(asNumber).toBe(1234.5);
  });

  it("keeps the typed text while editing and shows the canonical figure after blur", () => {
    let value = "";
    const { rerender } = render(
      <MoneyInput
        value={value}
        onChange={(event) => (value = event.target.value)}
        aria-label="amount"
      />,
    );
    const input = screen.getByLabelText("amount") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1,234.50" } });
    rerender(<MoneyInput value={value} onChange={() => {}} aria-label="amount" />);
    expect(input.value).toBe("1,234.50");
    fireEvent.blur(input);
    expect(input.value).toBe("1234.50");
  });

  it("onValueChange receives the number (null while empty)", () => {
    const seen: (number | null)[] = [];
    function Harness() {
      const [amount, setAmount] = useState<number | null>(null);
      return (
        <MoneyInput
          value={amount}
          onValueChange={(next) => {
            seen.push(next);
            setAmount(next);
          }}
          aria-label="amount"
        />
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText("amount");
    fireEvent.change(input, { target: { value: "0.5" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(seen).toEqual([0.5, null]);
  });

  it("shows the currency adornment inside the field and describes the input with it", () => {
    render(<MoneyInput value="" adornment="SAR" onChange={() => {}} aria-label="amount" />);
    const input = screen.getByLabelText("amount");
    const id = input.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(id.split(" ").pop() ?? "")?.textContent).toBe("SAR");
  });

  it("the prominent size is the token-driven 44px / 16px / 2px amount field", () => {
    render(<MoneyInput value="" inputSize="prominent" onChange={() => {}} aria-label="amount" />);
    const className = screen.getByLabelText("amount").className;
    expect(className).toContain("h-(--control-height-prominent)");
    expect(className).toContain("border-(length:--control-border-prominent)");
    expect(className).toContain("text-card-title");
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
