import { describe, expect, it } from "vitest";
import { availabilityShortfalls, availabilitySource } from "./line-availability";

describe("line availability (R15 W1, spec 1.10)", () => {
  it("reads own stock, a kit's components, or nothing for a service", () => {
    expect(availabilitySource({ isInventoryItem: true, supplyMethod: "PURCHASED" })).toBe("STOCK");
    expect(availabilitySource({ isInventoryItem: false, supplyMethod: "KIT" })).toBe("KIT");
    expect(availabilitySource({ isInventoryItem: false, supplyMethod: "PURCHASED" })).toBe("NONE");
  });

  it("warns per product when the summed lines exceed what is available", () => {
    const available = new Map<string, number | null>([
      ["a", 5],
      ["b", 10],
      ["c", null],
    ]);
    expect(
      availabilityShortfalls(
        [
          { productId: "a", quantity: 3 },
          { productId: "a", quantity: 3 },
          { productId: "b", quantity: 10 },
          { productId: "c", quantity: 99 },
          { productId: "d", quantity: 1 },
          { productId: null, quantity: 4 },
        ],
        available,
      ),
    ).toEqual([{ productId: "a", requested: 6, available: 5 }]);
  });

  it("never warns while nothing is ordered or the figure is unknown", () => {
    expect(availabilityShortfalls([], new Map())).toEqual([]);
    expect(availabilityShortfalls([{ productId: "x", quantity: 0 }], new Map([["x", 0]]))).toEqual(
      [],
    );
  });
});
