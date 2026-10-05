import { describe, expect, it } from "vitest";
import { kitComponentRows, kitLines } from "./kit-fulfillment";

const snapshot = {
  recipeId: "r-1",
  version: 2,
  components: [
    { productId: "a", qtyPerKit: 2, unitCost: "10.0000" },
    { productId: "b", qtyPerKit: "1", unitCost: null },
  ],
};

describe("kitComponentRows", () => {
  it("multiplies the per-kit quantity by the kits sold", () => {
    expect(kitComponentRows(snapshot, 3, true)).toEqual([
      { productId: "a", perKit: 2, delivered: 6, unitCost: "10.0000" },
      { productId: "b", perKit: 1, delivered: 3, unitCost: null },
    ]);
  });

  it("never shows a cost to a caller without cost visibility", () => {
    expect(kitComponentRows(snapshot, 1, false).map((row) => row.unitCost)).toEqual([null, null]);
  });
});

describe("kitLines", () => {
  it("keeps only lines fulfilled from components", () => {
    const items = [
      { id: "1", fulfillmentSnapshot: snapshot },
      { id: "2", fulfillmentSnapshot: null },
      { id: "3" },
      { id: "4", fulfillmentSnapshot: { ...snapshot, components: [] } },
    ];
    expect(kitLines(items).map((item) => item.id)).toEqual(["1"]);
  });
});
