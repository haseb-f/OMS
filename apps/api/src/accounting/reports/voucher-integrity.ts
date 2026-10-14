/**
 * R18 — receipt / payment integrity rules (pure, unit-tested). The money a
 * voucher moved, its invoice allocations and its journal entry must agree:
 * every rule compares stored facts, never recomputes a report figure.
 *
 * ERROR rules are invariant breaches. REVIEW lists confirmed vouchers that
 * apply only part of their money to invoices while leaving the rest as an
 * advance — legitimate when an advance was intended, the shape of the R18
 * defect (an invoice-balance amount kept after the allocation was lowered)
 * when it was not; a person decides.
 */

export type VoucherIntegrityCode =
  | 'VOUCHER_OVER_ALLOCATED'
  | 'INVOICE_OVER_ALLOCATED'
  | 'ENTRY_MISSING'
  | 'ENTRY_DUPLICATED'
  | 'CANCELLED_ENTRY_ACTIVE'
  | 'CASH_LINE_MISMATCH'
  | 'BANK_MATCH_AMOUNT_MISMATCH'
  | 'PARTIAL_WITH_UNAPPLIED';

export interface VoucherIntegrityIssue {
  code: VoucherIntegrityCode;
  severity: 'ERROR' | 'REVIEW';
  documentType: string;
  documentId: string;
  documentNumber: string;
  partnerName: string | null;
  detail: string;
  amounts: Record<string, number>;
}

export interface VoucherView {
  id: string;
  transactionNumber: string;
  /** R22-T — other receipts / payments / transfers are checked too (no allocations). */
  type:
    | 'CUSTOMER_RECEIPT'
    | 'SUPPLIER_PAYMENT'
    | 'OTHER_RECEIPT'
    | 'OTHER_PAYMENT'
    | 'INTERNAL_TRANSFER';
  status: 'CONFIRMED' | 'CANCELLED';
  amount: number;
  feeAmount: number;
  exchangeRate: number | null;
  cashAccountId: string | null;
  partnerName: string | null;
  /** Store-order claim receipts allocate by the order position: advances are normal there. */
  storeOrderReceipt: boolean;
  allocations: { allocatedAmount: number; invoiceNumber: string | null }[];
}

export interface EntryView {
  sourceId: string;
  reversalOfEntryId: string | null;
  /** Entry already reversed by a later entry. */
  reversed: boolean;
  lines: { accountId: string; debit: number; credit: number }[];
}

export interface InvoiceAllocationView {
  documentType: 'SALES_INVOICE' | 'PURCHASE_INVOICE';
  id: string;
  invoiceNumber: string;
  partnerName: string | null;
  grandTotal: number;
  allocatedTotal: number;
}

export interface BankMatchView {
  id: string;
  reference: string;
  bankAmount: number;
  documentNumber: string;
  documentAmount: number;
}

const TOLERANCE = 0.005;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function evaluateVoucherIntegrity(input: {
  vouchers: VoucherView[];
  entries: EntryView[];
  invoices: InvoiceAllocationView[];
  bankMatches: BankMatchView[];
}): VoucherIntegrityIssue[] {
  const issues: VoucherIntegrityIssue[] = [];
  const activeBySource = new Map<string, EntryView[]>();
  for (const entry of input.entries) {
    if (entry.reversalOfEntryId || entry.reversed) continue;
    const list = activeBySource.get(entry.sourceId) ?? [];
    list.push(entry);
    activeBySource.set(entry.sourceId, list);
  }

  for (const voucher of input.vouchers) {
    const base = {
      documentType: voucher.type,
      documentId: voucher.id,
      documentNumber: voucher.transactionNumber,
      partnerName: voucher.partnerName,
    };
    const allocated = round2(
      voucher.allocations.reduce((sum, line) => sum + line.allocatedAmount, 0),
    );
    const available = round2(voucher.amount + voucher.feeAmount);
    const active = activeBySource.get(voucher.id) ?? [];

    if (voucher.status === 'CANCELLED') {
      if (active.length > 0) {
        issues.push({
          ...base,
          code: 'CANCELLED_ENTRY_ACTIVE',
          severity: 'ERROR',
          detail: 'Cancelled voucher still has a posted, unreversed entry.',
          amounts: { entries: active.length },
        });
      }
      continue;
    }

    if (allocated - available > TOLERANCE) {
      issues.push({
        ...base,
        code: 'VOUCHER_OVER_ALLOCATED',
        severity: 'ERROR',
        detail: 'Allocations exceed the money the voucher moved (plus fee).',
        amounts: { amount: voucher.amount, fee: voucher.feeAmount, allocated },
      });
    }
    if (active.length === 0 && voucher.amount > 0) {
      issues.push({
        ...base,
        code: 'ENTRY_MISSING',
        severity: 'ERROR',
        detail: 'Confirmed voucher has no posted entry.',
        amounts: { amount: voucher.amount },
      });
    }
    if (active.length > 1) {
      issues.push({
        ...base,
        code: 'ENTRY_DUPLICATED',
        severity: 'ERROR',
        detail: 'Confirmed voucher has more than one posted, unreversed entry.',
        amounts: { entries: active.length },
      });
    }
    // Compared only when the entry has a line on the account the voucher
    // names today: a receiving account re-mapped after posting is not a
    // voucher defect.
    const cashLines = voucher.cashAccountId
      ? (active[0]?.lines ?? []).filter(
          (line) => line.accountId === voucher.cashAccountId,
        )
      : [];
    if (active.length === 1 && cashLines.length > 0) {
      // Money in debits the cash line; money out (and a transfer's source) credits it.
      const cashSide =
        voucher.type === 'CUSTOMER_RECEIPT' || voucher.type === 'OTHER_RECEIPT'
          ? 'debit'
          : 'credit';
      const posted = round2(
        cashLines.reduce(
          (sum, line) => sum + line[cashSide] - line[otherSide(cashSide)],
          0,
        ),
      );
      const expected = round2(voucher.amount * (voucher.exchangeRate ?? 1));
      if (Math.abs(posted - expected) > 0.01) {
        issues.push({
          ...base,
          code: 'CASH_LINE_MISMATCH',
          severity: 'ERROR',
          detail:
            'The cash / bank line differs from the voucher amount at its rate.',
          amounts: { expected, posted },
        });
      }
    }
    const unapplied = round2(available - allocated);
    if (
      !voucher.storeOrderReceipt &&
      allocated > TOLERANCE &&
      unapplied > TOLERANCE
    ) {
      issues.push({
        ...base,
        code: 'PARTIAL_WITH_UNAPPLIED',
        severity: 'REVIEW',
        detail: `Applies ${allocated.toFixed(2)} to ${voucher.allocations
          .map((line) => line.invoiceNumber ?? '—')
          .join(
            ', ',
          )} and keeps ${unapplied.toFixed(2)} as an advance — confirm the money actually received.`,
        amounts: { amount: voucher.amount, allocated, unapplied },
      });
    }
  }

  for (const invoice of input.invoices) {
    if (invoice.allocatedTotal - invoice.grandTotal > TOLERANCE) {
      issues.push({
        code: 'INVOICE_OVER_ALLOCATED',
        severity: 'ERROR',
        documentType: invoice.documentType,
        documentId: invoice.id,
        documentNumber: invoice.invoiceNumber,
        partnerName: invoice.partnerName,
        detail: 'Confirmed allocations exceed the invoice total.',
        amounts: {
          grandTotal: invoice.grandTotal,
          allocated: invoice.allocatedTotal,
        },
      });
    }
  }

  for (const match of input.bankMatches) {
    if (Math.abs(Math.abs(match.bankAmount) - match.documentAmount) > 0.01) {
      issues.push({
        code: 'BANK_MATCH_AMOUNT_MISMATCH',
        severity: 'ERROR',
        documentType: 'BANK_TRANSACTION',
        documentId: match.id,
        documentNumber: match.reference,
        partnerName: null,
        detail: `Bank line matched to ${match.documentNumber} for a different amount.`,
        amounts: {
          bank: Math.abs(match.bankAmount),
          document: match.documentAmount,
        },
      });
    }
  }
  return issues;
}

function otherSide(side: 'debit' | 'credit'): 'debit' | 'credit' {
  return side === 'debit' ? 'credit' : 'debit';
}
