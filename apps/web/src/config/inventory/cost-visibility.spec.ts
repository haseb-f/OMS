import { describe, expect, it } from "vitest";
import {
  INVENTORY_COST_COLUMN_IDS,
  INVENTORY_COST_PERMISSIONS,
  canViewInventoryCost,
  omitInventoryCostColumns,
} from "./cost-visibility";

const columns = [
  { id: "movementNumber" },
  { id: "unitCost" },
  { id: "runningCost" },
  { id: "averageCost" },
  { id: "lastCost" },
  { id: "stockValue" },
  { id: "onHand" },
  {},
];
const has =
  (...granted: string[]) =>
  (permission: string) =>
    granted.includes(permission);

describe("inventory cost visibility (web mirror of the API rule)", () => {
  it("uses exactly the two existing costing permissions", () => {
    expect([...INVENTORY_COST_PERMISSIONS]).toEqual(["expenses.view", "cost-explorer.view"]);
  });

  it("a plain inventory viewer cannot see cost; either costing permission can", () => {
    expect(canViewInventoryCost(has("inventory.view"))).toBe(false);
    expect(canViewInventoryCost(has("expenses.view"))).toBe(true);
    expect(canViewInventoryCost(has("cost-explorer.view"))).toBe(true);
    // the user context's hasPermission already answers true for a super admin
    expect(canViewInventoryCost(() => true)).toBe(true);
  });

  it("removes every cost column (so its export column goes too) and nothing else", () => {
    const shown = omitInventoryCostColumns(columns, false);
    expect(shown.map((c) => c.id)).toEqual(["movementNumber", "onHand", undefined]);
    expect([...INVENTORY_COST_COLUMN_IDS].sort()).toEqual(
      ["averageCost", "lastCost", "runningCost", "stockValue", "unitCost"].sort(),
    );
  });

  it("keeps all columns for a caller who may see cost", () => {
    expect(omitInventoryCostColumns(columns, true)).toBe(columns);
  });
});
