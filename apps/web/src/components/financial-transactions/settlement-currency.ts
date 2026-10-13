import type { OpenInvoiceRow } from "@/services/financial-transactions-service";

/** The currency a receipt / supplier payment settles its invoices in (R20). */
export interface SettlementCurrency {
  currencyId: string;
  currencyCode: string | null;
}

/**
 * R20 — a voucher settles invoices of its own currency only (the API refuses
 * any other with CURRENCY_MISMATCH). The saved voucher's currency wins; a new
 * one takes the currency of the first invoice it allocates. Null while nothing
 * decides it yet — the first invoice chosen does. Display only: the API stores
 * and enforces it.
 */
export function resolveSettlementCurrency(
  saved: { currencyId: string | null; currency?: { code: string } | null } | null,
  lines: readonly { invoiceId: string }[],
  openInvoices: readonly OpenInvoiceRow[],
): SettlementCurrency | null {
  if (saved?.currencyId) {
    return { currencyId: saved.currencyId, currencyCode: saved.currency?.code ?? null };
  }
  const byId = new Map(openInvoices.map((row) => [row.invoiceId, row]));
  for (const line of lines) {
    const invoice = byId.get(line.invoiceId);
    if (invoice?.currencyId) {
      return { currencyId: invoice.currencyId, currencyCode: invoice.currencyCode };
    }
  }
  return null;
}

/** True when this open invoice cannot be settled by a voucher in `currency`. */
export function isOtherCurrency(
  invoice: Pick<OpenInvoiceRow, "currencyId">,
  currency: SettlementCurrency | null,
): boolean {
  return (
    currency !== null && invoice.currencyId !== null && invoice.currencyId !== currency.currencyId
  );
}

/**
 * "Pay all remaining": oldest first, only invoices of the voucher's currency
 * (the first open invoice's when none is set yet), capped by what is left.
 * Returns the lines' new amounts per invoice id (pure).
 */
export function planPayAllRemaining(
  openInvoices: readonly OpenInvoiceRow[],
  current: readonly { invoiceId: string; allocatedAmount: number }[],
  unallocated: number,
  currency: SettlementCurrency | null,
): Map<string, number> {
  const target =
    currency ??
    (openInvoices[0]?.currencyId
      ? { currencyId: openInvoices[0].currencyId, currencyCode: openInvoices[0].currencyCode }
      : null);
  const next = new Map(current.map((line) => [line.invoiceId, line.allocatedAmount]));
  let left = Math.round(unallocated * 100) / 100;
  for (const invoice of openInvoices) {
    if (left <= 0) break;
    if (isOtherCurrency(invoice, target)) continue;
    const already = next.get(invoice.invoiceId) ?? 0;
    const capacity = Math.round((invoice.remainingBalance - already) * 100) / 100;
    if (capacity <= 0) continue;
    const apply = Math.min(capacity, left);
    next.set(invoice.invoiceId, Math.round((already + apply) * 100) / 100);
    left = Math.round((left - apply) * 100) / 100;
  }
  return next;
}
