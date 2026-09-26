import { describe, expect, it } from "vitest";
import { filterByArabicSearch, normalizeArabicSearch } from "./arabic-search";

const options = [
  { label: "أحمد إبراهيم" },
  { label: "مؤسسة الهدى" },
  { label: "Acme Trading" },
  { label: "مستشفى" },
];

describe("filterByArabicSearch", () => {
  it("returns every item for an empty or blank query", () => {
    expect(filterByArabicSearch(options, "  ", (o) => o.label)).toHaveLength(4);
  });

  it("matches across hamza/alef variants, taa marbuta and alef maqsura", () => {
    expect(filterByArabicSearch(options, "احمد ابراهيم", (o) => o.label)).toEqual([options[0]]);
    expect(filterByArabicSearch(options, "مؤسسه", (o) => o.label)).toEqual([options[1]]);
    expect(filterByArabicSearch(options, "مستشفي", (o) => o.label)).toEqual([options[3]]);
  });

  it("is case-insensitive for Latin text", () => {
    expect(filterByArabicSearch(options, "ACME", (o) => o.label)).toEqual([options[2]]);
  });

  it("ignores tashkeel in the query", () => {
    expect(normalizeArabicSearch("أَحْمَد")).toBe("احمد");
  });
});
