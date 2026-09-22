import {
  JournalEntryStatus,
  PartnerControlAccountType,
  Prisma,
} from '@prisma/client';
import { roundReportMoney } from './financial-report-tree';

/**
 * The Journal Entry statuses every ledger report counts by default — a
 * REVERSED original and its POSTED reversal net to zero, exactly as the
 * Partner Statement / General Ledger (`postedOnly`) read them.
 */
export const LEDGER_BALANCE_STATUSES: JournalEntryStatus[] = [
  JournalEntryStatus.POSTED,
  JournalEntryStatus.REVERSED,
];

export interface PartnerLedgerBalance {
  /** RECEIVABLE control accounts, debit − credit: positive = customer owes us, negative = customer credit (advance, return not yet refunded). */
  receivable: number;
  /** PAYABLE control accounts, credit − debit: positive = we owe the supplier, negative = supplier debit (advance paid). */
  payable: number;
}

type LedgerClient = Pick<Prisma.TransactionClient, 'journalEntryLine'>;

/** Cent-rounded, never a negative zero (a settled partner shows 0.00). */
const money = (value: number) => roundReportMoney(value) || 0;

/**
 * Partner balances read from the posted ledger — the partner-tagged lines on
 * the AR/AP control accounts, in functional currency. The SAME lines (and
 * status set) the Customer/Supplier Statement's closing balance sums, so a
 * partner's displayed balance always reconciles with its statement and with
 * the AR/AP control accounts in the General Ledger. Documents never feed
 * this: an unallocated advance, a refund, an FX difference, an opening
 * balance or a bank fee all move the ledger without a document allocation.
 */
export async function partnerLedgerBalances(
  client: LedgerClient,
  partnerIds: string[],
): Promise<Map<string, PartnerLedgerBalance>> {
  const balances = new Map<string, PartnerLedgerBalance>();
  if (partnerIds.length === 0) return balances;

  const sumFor = (controlType: PartnerControlAccountType) =>
    client.journalEntryLine.groupBy({
      by: ['partnerId'],
      where: {
        partnerId: { in: partnerIds },
        account: { partnerControlType: controlType },
        journalEntry: {
          deletedAt: null,
          status: { in: LEDGER_BALANCE_STATUSES },
        },
      },
      _sum: { debit: true, credit: true },
    });

  const [receivable, payable] = await Promise.all([
    sumFor(PartnerControlAccountType.RECEIVABLE),
    sumFor(PartnerControlAccountType.PAYABLE),
  ]);

  const entry = (partnerId: string) => {
    let balance = balances.get(partnerId);
    if (!balance) {
      balance = { receivable: 0, payable: 0 };
      balances.set(partnerId, balance);
    }
    return balance;
  };
  for (const row of receivable) {
    if (!row.partnerId) continue;
    entry(row.partnerId).receivable = money(
      Number(row._sum.debit ?? 0) - Number(row._sum.credit ?? 0),
    );
  }
  for (const row of payable) {
    if (!row.partnerId) continue;
    entry(row.partnerId).payable = money(
      Number(row._sum.credit ?? 0) - Number(row._sum.debit ?? 0),
    );
  }
  return balances;
}
