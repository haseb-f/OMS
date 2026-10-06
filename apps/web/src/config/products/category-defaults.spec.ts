import { describe, expect, it } from "vitest";
import { NOT_INHERITED, applyCategoryDefaults } from "./category-defaults";

const empty = { unitId: "", taxId: "" };

describe("applyCategoryDefaults", () => {
  it("pre-fills an empty unit and tax from the category and marks them inherited", () => {
    expect(
      applyCategoryDefaults(empty, NOT_INHERITED, { defaultUnitId: "u-1", defaultTaxId: "t-1" }),
    ).toEqual({ unitId: "u-1", taxId: "t-1", inherited: { unit: true, tax: true } });
  });

  it("fills only what the category defines", () => {
    expect(applyCategoryDefaults(empty, NOT_INHERITED, { defaultUnitId: "u-1" })).toEqual({
      unitId: "u-1",
      taxId: "",
      inherited: { unit: true, tax: false },
    });
  });

  it("never overwrites a value the user chose", () => {
    expect(
      applyCategoryDefaults({ unitId: "u-own", taxId: "t-own" }, NOT_INHERITED, {
        defaultUnitId: "u-1",
        defaultTaxId: "t-1",
      }),
    ).toEqual({ unitId: "u-own", taxId: "t-own", inherited: NOT_INHERITED });
  });

  it("follows a later category change while the value is still inherited", () => {
    const first = applyCategoryDefaults(empty, NOT_INHERITED, { defaultUnitId: "u-1" });
    expect(applyCategoryDefaults(first, first.inherited, { defaultUnitId: "u-2" }).unitId).toBe(
      "u-2",
    );
  });

  it("a category without defaults keeps the value but it is no longer 'from the category'", () => {
    const first = applyCategoryDefaults(empty, NOT_INHERITED, {
      defaultUnitId: "u-1",
      defaultTaxId: "t-1",
    });
    expect(applyCategoryDefaults(first, first.inherited, {})).toEqual({
      unitId: "u-1",
      taxId: "t-1",
      inherited: NOT_INHERITED,
    });
  });

  it("an unknown category changes nothing", () => {
    expect(applyCategoryDefaults(empty, NOT_INHERITED, undefined)).toEqual({
      ...empty,
      inherited: NOT_INHERITED,
    });
  });
});
