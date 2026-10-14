import { describe, expect, it } from "vitest";
import {
  movementEffect,
  movementEffectTone,
  movementTypeOnlyTone,
  signedFigure,
} from "./movement-effect";

const row = (
  type: string,
  quantity: number,
  quantityBefore: number | null,
  quantityAfter: number | null,
) => ({
  type,
  quantity,
  quantityBefore,
  quantityAfter,
});

describe("movementEffect (stock movement signs and colours)", () => {
  it("receipts and customer returns add stock: green +", () => {
    for (const type of [
      "PURCHASE_RECEIPT",
      "SALES_RETURN",
      "OPENING_BALANCE",
      "CONSIGNMENT_RECEIPT",
      "PRODUCTION_OUTPUT",
    ]) {
      const effect = movementEffect(row(type, 100, 20, 120));
      expect(effect).toEqual({ kind: "physical", delta: 100, direction: "in" });
      expect(movementEffectTone(effect)).toBe("success");
    }
  });

  it("issues, deliveries, supplier returns, damage and consumption remove stock: red −", () => {
    for (const type of [
      "SALES_DELIVERY",
      "PURCHASE_RETURN",
      "DAMAGE",
      "EXPIRED",
      "PRODUCTION_CONSUMPTION",
    ]) {
      const effect = movementEffect(row(type, -100, 120, 20));
      expect(effect).toEqual({ kind: "physical", delta: -100, direction: "out" });
      expect(movementEffectTone(effect)).toBe("destructive");
    }
  });

  it("a transfer is red at the source warehouse and green at the destination", () => {
    expect(movementEffect(row("TRANSFER", -30, 50, 20))).toMatchObject({
      delta: -30,
      direction: "out",
    });
    expect(movementEffect(row("TRANSFER", 30, 0, 30))).toMatchObject({
      delta: 30,
      direction: "in",
    });
  });

  it("the sign follows the effect at the warehouse, not the stored sign", () => {
    // An adjustment / count of either direction, read from before → after.
    expect(movementEffect(row("ADJUSTMENT", 5, 40, 35))).toMatchObject({
      delta: -5,
      direction: "out",
    });
    expect(movementEffect(row("PHYSICAL_COUNT", -2, 10, 12))).toMatchObject({
      delta: 2,
      direction: "in",
    });
  });

  it("zero physical change is neutral", () => {
    const effect = movementEffect(row("ADJUSTMENT", 0, 10, 10));
    expect(effect).toEqual({ kind: "physical", delta: 0, direction: "none" });
    expect(movementEffectTone(effect)).toBe("neutral");
  });

  it("a reservation lowers what is available (blue, never a red issue) and leaves on-hand alone", () => {
    // Stored as +10 on the reserved ledger; on-hand before = after.
    const effect = movementEffect(row("RESERVATION", 10, 50, 50));
    expect(effect).toEqual({ kind: "reservation", action: "reserve", availableDelta: -10 });
    expect(movementEffectTone(effect)).toBe("info");
  });

  it("a release raises what is available (blue, never a green receipt)", () => {
    // Stored as −10 on the reserved ledger.
    const effect = movementEffect(row("RESERVATION_RELEASE", -10, 50, 50));
    expect(effect).toEqual({ kind: "reservation", action: "release", availableDelta: 10 });
    expect(movementEffectTone(effect)).toBe("info");
  });

  it("without before / after (agent history) the stored per-warehouse sign is used", () => {
    expect(movementEffect(row("SALES_DELIVERY", -3, null, null))).toMatchObject({
      delta: -3,
      direction: "out",
    });
    expect(movementEffect(row("RESERVATION", 3, null, null))).toMatchObject({ availableDelta: -3 });
  });

  it("signed figures use a real minus sign", () => {
    expect(signedFigure(100)).toBe("+100");
    expect(signedFigure(-100)).toBe("−100");
    expect(signedFigure(0)).toBe("0");
    expect(signedFigure(-1500, (n) => n.toLocaleString("en-US"))).toBe("−1,500");
  });

  it("type-only tone (record preview)", () => {
    expect(movementTypeOnlyTone("RESERVATION")).toBe("info");
    expect(movementTypeOnlyTone("RESERVATION_RELEASE")).toBe("info");
    expect(movementTypeOnlyTone("PURCHASE_RECEIPT")).toBe("success");
    expect(movementTypeOnlyTone("SALES_DELIVERY")).toBe("destructive");
    expect(movementTypeOnlyTone("TRANSFER")).toBe("neutral");
  });
});
