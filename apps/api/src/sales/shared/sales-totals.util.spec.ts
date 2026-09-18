import {
  computeSalesDocumentTotals,
  computeSalesLine,
} from './sales-totals.util';

describe('computeSalesLine VAT', () => {
  it('computes exclusive VAT15 with rounding to 2 decimals', () => {
    const line = computeSalesLine({
      quantity: 1,
      unitPrice: 100,
      taxRatePercent: 15,
    });
    expect(line.taxAmount).toBe(15);
    expect(line.lineTotal).toBe(115);
  });

  it('extracts inclusive VAT15 from a tax-inclusive unit price', () => {
    const line = computeSalesLine({
      quantity: 1,
      unitPrice: 115,
      taxRatePercent: 15,
      taxInclusive: true,
    });
    expect(line.taxAmount).toBe(15);
    expect(line.lineTotal).toBe(115);
    expect(line.lineSubtotal).toBe(115);
  });

  it('keeps explicit VAT0 as zero without treating the line as missing tax', () => {
    const line = computeSalesLine({
      quantity: 2,
      unitPrice: 50,
      taxRatePercent: 0,
    });
    expect(line.taxAmount).toBe(0);
    expect(line.lineTotal).toBe(100);
  });

  it('applies discount before exclusive tax', () => {
    const line = computeSalesLine({
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
});

describe('computeSalesDocumentTotals', () => {
  it('sums line totals so mixed inclusive/exclusive lines stay consistent', () => {
    const exclusive = computeSalesLine({
      quantity: 1,
      unitPrice: 100,
      taxRatePercent: 15,
    });
    const inclusive = computeSalesLine({
      quantity: 1,
      unitPrice: 115,
      taxRatePercent: 15,
      taxInclusive: true,
    });
    const totals = computeSalesDocumentTotals([exclusive, inclusive]);
    expect(totals.subtotal).toBe(215);
    expect(totals.taxTotal).toBe(30);
    expect(totals.grandTotal).toBe(230);
  });
});
