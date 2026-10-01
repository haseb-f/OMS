import { describe, expect, it } from "vitest";
import { cellCopyText, clampColumnWidth } from "./enterprise-data-table";

describe("EnterpriseDataTable shared controls (R6 B2/B4)", () => {
  it("offers copy only on phone/reference cells with a real value", () => {
    expect(cellCopyText("phone", "+201001234567")).toBe("+201001234567");
    expect(cellCopyText("reference", " SO-2026-000012 ")).toBe("SO-2026-000012");
    expect(cellCopyText("phone", "—")).toBeNull();
    expect(cellCopyText("reference", "")).toBeNull();
    expect(cellCopyText("name", "Acme")).toBeNull();
    expect(cellCopyText(undefined, "x")).toBeNull();
  });

  it("clamps resize / auto-fit widths to the column bounds", () => {
    expect(clampColumnWidth(20, 60)).toBe(60);
    expect(clampColumnWidth(5000, 60)).toBe(640);
    expect(clampColumnWidth(180.4, 148)).toBe(180);
  });
});
