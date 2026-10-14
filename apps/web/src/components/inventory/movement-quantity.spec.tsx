import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MovementQuantity } from "./movement-quantity";
import { LocaleProvider } from "@/providers/locale-provider";

const view = (row: {
  type: string;
  quantity: number;
  quantityBefore?: number;
  quantityAfter?: number;
}) =>
  render(
    <LocaleProvider>
      <MovementQuantity row={row} />
    </LocaleProvider>,
  ).container;

describe("MovementQuantity", () => {
  it("reservation: blue 'available −10' with a lock icon and the on-hand note", () => {
    const el = view({ type: "RESERVATION", quantity: 10, quantityBefore: 5, quantityAfter: 5 });
    const root = el.querySelector("[data-effect]")!;
    expect(root.getAttribute("data-effect")).toBe("reserve");
    expect(root.className).toContain("text-info-soft-foreground");
    expect(root.textContent).toContain("−10");
    expect(root.getAttribute("title")).toBeTruthy();
  });

  it("release: 'available +10', never green", () => {
    const root = view({
      type: "RESERVATION_RELEASE",
      quantity: -10,
      quantityBefore: 5,
      quantityAfter: 5,
    }).querySelector("[data-effect]")!;
    expect(root.getAttribute("data-effect")).toBe("release");
    expect(root.textContent).toContain("+10");
    expect(root.className).not.toContain("text-success");
  });

  it("receipt green +100, issue red −100, zero neutral", () => {
    const inRoot = view({
      type: "PURCHASE_RECEIPT",
      quantity: 100,
      quantityBefore: 0,
      quantityAfter: 100,
    }).querySelector("[data-effect]")!;
    expect(inRoot.className).toContain("text-success");
    expect(inRoot.textContent).toContain("+100");
    const outRoot = view({
      type: "SALES_DELIVERY",
      quantity: -100,
      quantityBefore: 100,
      quantityAfter: 0,
    }).querySelector("[data-effect]")!;
    expect(outRoot.className).toContain("text-destructive");
    expect(outRoot.textContent).toContain("−100");
    const none = view({
      type: "ADJUSTMENT",
      quantity: 0,
      quantityBefore: 4,
      quantityAfter: 4,
    }).querySelector("[data-effect]")!;
    expect(none.getAttribute("data-effect")).toBe("none");
  });
});
