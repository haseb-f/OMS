import { describe, expect, it } from "vitest";
import { previewSalesDocumentTotals, previewSalesLine } from "./sales-line-preview-math";

describe("previewSalesLine", () => {
  it("computes qty × price with discount percent and tax", () => {
    const line = previewSalesLine({
      quantity: 2,
      unitPrice: 100,
      discountPercent: 10,
      taxRatePercent: 15,
    });
    expect(line.lineSubtotal).toBe(200);
    expect(line.discountAmount).toBe(20);
    expect(line.taxAmount).toBe(27);
    expect(line.lineTotal).toBe(207);
  });

  it("treats missing tax and discount as zero", () => {
    const line = previewSalesLine({ quantity: 3, unitPrice: 12.5 });
    expect(line.lineTotal).toBe(37.5);
    expect(line.taxAmount).toBe(0);
    expect(line.discountAmount).toBe(0);
  });
});

describe("previewSalesDocumentTotals", () => {
  it("sums preview lines the same way the grid footer would", () => {
    const totals = previewSalesDocumentTotals([
      previewSalesLine({ quantity: 1, unitPrice: 50, discountPercent: 0, taxRatePercent: 0 }),
      previewSalesLine({ quantity: 2, unitPrice: 25, discountPercent: 10, taxRatePercent: 0 }),
    ]);
    expect(totals.subtotal).toBe(100);
    expect(totals.discountTotal).toBe(5);
    expect(totals.grandTotal).toBe(95);
  });
});
