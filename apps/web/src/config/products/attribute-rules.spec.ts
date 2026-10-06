import { describe, expect, it } from "vitest";
import {
  attributePatch,
  changeItemType,
  changeSupplyMethod,
  defaultsForItemType,
  investmentBlockedReason,
  investmentSwitchState,
  settleAttributes,
  stockTrackingState,
  supplyMethodVisible,
  usesRecipe,
  type ProductAttributes,
} from "./attribute-rules";

const product: ProductAttributes = defaultsForItemType("PRODUCT");
const service: ProductAttributes = defaultsForItemType("SERVICE");

describe("item type defaults", () => {
  it("a product sells, buys and is tracked; a service only sells and is never tracked", () => {
    expect(product).toEqual({
      itemType: "PRODUCT",
      isSellable: true,
      isPurchasable: true,
      isInventoryItem: true,
      supplyMethod: "PURCHASED",
    });
    expect(service).toEqual({
      itemType: "SERVICE",
      isSellable: true,
      isPurchasable: false,
      isInventoryItem: false,
      supplyMethod: "PURCHASED",
    });
  });

  it("changing the item type applies the new type's defaults; re-picking the same type keeps the choices", () => {
    const customised = { ...product, isPurchasable: false, supplyMethod: "KIT" as const };
    expect(changeItemType(customised, "PRODUCT")).toBe(customised);
    expect(changeItemType(customised, "SERVICE")).toEqual(service);
    expect(changeItemType(service, "PRODUCT")).toEqual(product);
  });

  it("sell and purchase are independent: both may be on, and neither implies the other", () => {
    const both = settleAttributes({ ...product, isSellable: true, isPurchasable: true });
    expect(both.isSellable && both.isPurchasable).toBe(true);
    const buyOnly = settleAttributes({ ...product, isSellable: false });
    expect(buyOnly.isPurchasable).toBe(true);
    expect(buyOnly.isSellable).toBe(false);
  });
});

describe("track stock", () => {
  it("is hidden for a service", () => {
    expect(stockTrackingState(service)).toMatchObject({ visible: false, value: false });
  });

  it("is free for a purchased product", () => {
    expect(stockTrackingState({ ...product, isInventoryItem: false })).toEqual({
      visible: true,
      value: false,
      locked: false,
      reason: null,
    });
  });

  it("is forced off and locked for a kit, with the reason", () => {
    expect(stockTrackingState({ ...product, supplyMethod: "KIT" })).toEqual({
      visible: true,
      value: false,
      locked: true,
      reason: "KIT",
    });
  });

  it("is forced on and locked for an assembled item, even if stored off", () => {
    expect(
      stockTrackingState({ ...product, supplyMethod: "ASSEMBLED", isInventoryItem: false }),
    ).toEqual({ visible: true, value: true, locked: true, reason: "ASSEMBLED" });
  });
});

describe("supply method", () => {
  it("applies to a product only, and only Assembled / Kit use a recipe", () => {
    expect(supplyMethodVisible("PRODUCT")).toBe(true);
    expect(supplyMethodVisible("SERVICE")).toBe(false);
    expect(usesRecipe(product)).toBe(false);
    expect(usesRecipe({ ...product, supplyMethod: "ASSEMBLED" })).toBe(true);
    expect(usesRecipe({ ...product, supplyMethod: "KIT" })).toBe(true);
    expect(usesRecipe({ ...service, supplyMethod: "KIT" })).toBe(false);
  });

  it("choosing Kit turns tracking off, Assembled turns it on", () => {
    expect(changeSupplyMethod(product, "KIT").isInventoryItem).toBe(false);
    expect(changeSupplyMethod({ ...product, isInventoryItem: false }, "ASSEMBLED")).toMatchObject({
      supplyMethod: "ASSEMBLED",
      isInventoryItem: true,
    });
  });

  it("leaving Kit for Purchased restores the product default (tracked)", () => {
    const kit = changeSupplyMethod(product, "KIT");
    expect(changeSupplyMethod(kit, "PURCHASED")).toMatchObject({
      supplyMethod: "PURCHASED",
      isInventoryItem: true,
    });
  });

  it("leaving Assembled for Purchased keeps the user's tracking choice", () => {
    const assembled = changeSupplyMethod(product, "ASSEMBLED");
    expect(changeSupplyMethod(assembled, "PURCHASED").isInventoryItem).toBe(true);
  });

  it("settle enforces the server's hard rules", () => {
    expect(
      settleAttributes({ ...service, isInventoryItem: true, supplyMethod: "ASSEMBLED" }),
    ).toMatchObject({ isInventoryItem: false, supplyMethod: "PURCHASED" });
    expect(
      settleAttributes({ ...product, supplyMethod: "KIT", isInventoryItem: true }),
    ).toMatchObject({ isInventoryItem: false });
    expect(
      settleAttributes({ ...product, supplyMethod: "ASSEMBLED", isInventoryItem: false }),
    ).toMatchObject({ isInventoryItem: true });
  });
});

describe("attributePatch (edit)", () => {
  it("sends nothing when the attributes are untouched, so an unrelated edit never re-validates history", () => {
    expect(attributePatch(product, { ...product })).toEqual({});
  });

  it("sends the whole set once any attribute changed", () => {
    const next = { ...product, isPurchasable: false };
    expect(attributePatch(product, next)).toEqual(next);
  });

  it("sends the whole set on create", () => {
    expect(attributePatch(null, product)).toEqual(product);
  });
});

describe("investor eligibility", () => {
  const eligible = {
    isAgentOwned: false,
    itemType: "PRODUCT" as const,
    isSellable: true,
    status: "ACTIVE" as const,
  };

  it("reports the first blocking reason in the server's order", () => {
    expect(investmentBlockedReason(eligible)).toBeNull();
    expect(investmentBlockedReason({ ...eligible, isAgentOwned: true, itemType: "SERVICE" })).toBe(
      "AGENT_OWNED",
    );
    expect(investmentBlockedReason({ ...eligible, itemType: "SERVICE", isSellable: false })).toBe(
      "SERVICE",
    );
    expect(investmentBlockedReason({ ...eligible, isSellable: false, status: "DRAFT" })).toBe(
      "NOT_SELLABLE",
    );
    expect(investmentBlockedReason({ ...eligible, status: "DRAFT" })).toBe("NOT_ACTIVE");
    expect(investmentBlockedReason({ ...eligible, archived: true })).toBe("NOT_ACTIVE");
  });

  it("an unblocked switch is free", () => {
    expect(investmentSwitchState(eligible, false, false)).toEqual({
      blockedReason: null,
      disabled: false,
      value: false,
    });
  });

  it("a blocked switch cannot be turned on and is never sent as on for a new flag", () => {
    expect(investmentSwitchState({ ...eligible, status: "DRAFT" }, true, false)).toEqual({
      blockedReason: "NOT_ACTIVE",
      disabled: true,
      value: false,
    });
  });

  it("an existing flag on a now-blocked product can still be turned off", () => {
    const blocked = { ...eligible, isAgentOwned: true };
    expect(investmentSwitchState(blocked, true, true)).toEqual({
      blockedReason: "AGENT_OWNED",
      disabled: false,
      value: true,
    });
    expect(investmentSwitchState(blocked, false, true)).toMatchObject({
      disabled: true,
      value: false,
    });
  });
});
