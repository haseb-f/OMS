import type { AllocationGridLine } from "./allocation-grid";

/**
 * R18 — what each allocation line of a saved voucher can still settle. The API
 * returns allocations without the invoice balance, so a saved line used its own
 * amount as "remaining" and every saved line read "fully paid". Capacity is the
 * invoice's current open balance, plus the line itself once the voucher is
 * confirmed (its allocation is already inside that balance); an invoice no
 * longer open has nothing left beyond the line.
 */
export function withInvoiceCapacity(
  lines: AllocationGridLine[],
  openInvoices: readonly { invoiceId: string; remainingBalance: number }[],
  confirmed: boolean,
): AllocationGridLine[] {
  const open = new Map(openInvoices.map((row) => [row.invoiceId, row.remainingBalance]));
  return lines.map((line) => {
    const balance = open.get(line.invoiceId);
    const remainingBalance = confirmed
      ? Math.round(((balance ?? 0) + line.allocatedAmount) * 100) / 100
      : (balance ?? line.remainingBalance);
    return remainingBalance === line.remainingBalance ? line : { ...line, remainingBalance };
  });
}
