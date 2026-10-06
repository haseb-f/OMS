import { describe, expect, it } from "vitest";
import { movementReferenceLink } from "@/config/traceability/record-routes";
import { hasMovementTrace, movementTrace } from "./movement-trace";

describe("movementTrace", () => {
  it("a kit component / assembly consumption belongs to its parent and the parent's recipe", () => {
    const trace = movementTrace({ productId: "comp", parentProductId: "kit", recipeId: "r-1" });
    expect(trace).toEqual({ parentProductId: "kit", recipeId: "r-1", recipeProductId: "kit" });
    expect(hasMovementTrace(trace)).toBe(true);
  });

  it("an assembly output carries only the recipe of the moved (finished) product", () => {
    expect(movementTrace({ productId: "fg", parentProductId: null, recipeId: "r-2" })).toEqual({
      parentProductId: null,
      recipeId: "r-2",
      recipeProductId: "fg",
    });
  });

  it("an ordinary movement has no trace", () => {
    const trace = movementTrace({ productId: "p" });
    expect(trace).toEqual({ parentProductId: null, recipeId: null, recipeProductId: null });
    expect(hasMovementTrace(trace)).toBe(false);
  });
});

describe("movementReferenceLink", () => {
  it("links an assembly movement to its assembly order", () => {
    expect(movementReferenceLink("ASSEMBLY_ORDER", "o-1")).toEqual({
      labelKey: "assembly.referenceLabel",
      href: "/inventory/assembly/o-1",
    });
  });

  it("keeps the trace-kind documents and their pages", () => {
    expect(movementReferenceLink("SALES_INVOICE", "i-1")).toEqual({
      labelKey: "docFlow.kinds.SALES_INVOICE",
      href: "/sales/invoices/i-1",
    });
  });

  it("has no link without a reference id, and nothing for an unknown type", () => {
    expect(movementReferenceLink("ASSEMBLY_ORDER", null)?.href).toBeNull();
    expect(movementReferenceLink("SOMETHING", "x")).toBeNull();
    expect(movementReferenceLink(null, "x")).toBeNull();
  });
});
