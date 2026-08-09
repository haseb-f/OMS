/**
 * Sales Foundation (TASK-037) — the one totals calculation shared by all
 * four Sales documents (Quotation/Order/Invoice/Return), so `subtotal`/
 * `discountTotal`/`taxTotal`/`grandTotal` are computed the same way
 * everywhere rather than four hand-rolled copies. Server-computed only —
 * never trusted from the client (see the schema comment on
 * SalesQuotation.subtotal for why this deliberately differs from
 * PurchaseOrderItem.subtotal being caller-supplied).
 */

export interface SalesLineInput {
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  discountValue?: number;
  /** Resolved `Tax.rate` percent (e.g. 15 for 15%) — the caller looks this
   * up once per line before calling in, this util does no DB access. */
  taxRatePercent?: number;
}

export interface ComputedSalesLine {
  lineSubtotal: number;
  discountAmount: number;
  taxAmount: number;
  lineTotal: number;
}

export interface ComputedSalesDocumentTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeSalesLine(input: SalesLineInput): ComputedSalesLine {
  const lineSubtotal = round2(input.quantity * input.unitPrice);
  const percentDiscount = lineSubtotal * ((input.discountPercent ?? 0) / 100);
  const discountAmount = round2(percentDiscount + (input.discountValue ?? 0));
  const taxableAmount = Math.max(lineSubtotal - discountAmount, 0);
  const taxAmount = round2(taxableAmount * ((input.taxRatePercent ?? 0) / 100));
  const lineTotal = round2(taxableAmount + taxAmount);
  return { lineSubtotal, discountAmount, taxAmount, lineTotal };
}

export function computeSalesDocumentTotals(
  lines: ComputedSalesLine[],
): ComputedSalesDocumentTotals {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.lineSubtotal, 0));
  const discountTotal = round2(
    lines.reduce((sum, l) => sum + l.discountAmount, 0),
  );
  const taxTotal = round2(lines.reduce((sum, l) => sum + l.taxAmount, 0));
  const grandTotal = round2(subtotal - discountTotal + taxTotal);
  return { subtotal, discountTotal, taxTotal, grandTotal };
}
