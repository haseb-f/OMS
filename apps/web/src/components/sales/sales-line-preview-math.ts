/**
 * Sales Document Editor Foundation (TASK-039) — INSTANT PREVIEW ONLY.
 *
 * Mirrors the algorithm in `apps/api/src/sales/shared/sales-totals.util.ts`
 * so a line's total updates the moment a user types a quantity/price/
 * discount, instead of the UI sitting frozen until a round-trip returns.
 * This is the one and only place client-side math is allowed to exist in
 * the Sales Document Editor — and even here it is never trusted as the
 * saved figure. `DocumentTotalsFooter` never calls this file; it only ever
 * renders a `totals` object supplied by whichever document type's own
 * backend call computed it. If the two ever disagree, the backend wins,
 * full stop.
 */

export interface SalesLinePreviewInput {
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  discountValue?: number;
  taxRatePercent?: number;
}

export interface SalesLinePreview {
  lineSubtotal: number;
  discountAmount: number;
  taxAmount: number;
  lineTotal: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function previewSalesLine(input: SalesLinePreviewInput): SalesLinePreview {
  const quantity = Number.isFinite(input.quantity) ? input.quantity : 0;
  const unitPrice = Number.isFinite(input.unitPrice) ? input.unitPrice : 0;
  const lineSubtotal = round2(quantity * unitPrice);
  const percentDiscount = lineSubtotal * ((input.discountPercent ?? 0) / 100);
  const discountAmount = round2(percentDiscount + (input.discountValue ?? 0));
  const taxableAmount = Math.max(lineSubtotal - discountAmount, 0);
  const taxAmount = round2(taxableAmount * ((input.taxRatePercent ?? 0) / 100));
  const lineTotal = round2(taxableAmount + taxAmount);
  return { lineSubtotal, discountAmount, taxAmount, lineTotal };
}

export function previewSalesDocumentTotals(lines: SalesLinePreview[]) {
  const subtotal = round2(lines.reduce((sum, line) => sum + line.lineSubtotal, 0));
  const discountTotal = round2(lines.reduce((sum, line) => sum + line.discountAmount, 0));
  const taxTotal = round2(lines.reduce((sum, line) => sum + line.taxAmount, 0));
  const grandTotal = round2(subtotal - discountTotal + taxTotal);
  return { subtotal, discountTotal, taxTotal, grandTotal };
}
