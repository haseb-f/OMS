import { Prisma } from '@prisma/client';
import { roundReportMoney } from './financial-report-tree';

/**
 * The one Journal Entry Line projection every ledger-style report (General
 * Ledger, Account Statement, Customer/Supplier Statement) reads — entry
 * header, journal, partner and account — so their movement rows are
 * identical and each can drill down to the source JE and document.
 */
export const LEDGER_LINE_INCLUDE = {
  account: {
    select: {
      id: true,
      code: true,
      name: true,
      nameEn: true,
      partnerControlType: true,
    },
  },
  partner: { select: { id: true, partnerNumber: true, name: true } },
  journalEntry: {
    select: {
      id: true,
      entryNumber: true,
      entryDate: true,
      description: true,
      sourceType: true,
      sourceId: true,
      referenceNumber: true,
      status: true,
      journal: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.JournalEntryLineInclude;

/** Chronological, then by entry number, then line order — stable running balances. */
export const LEDGER_LINE_ORDER: Prisma.JournalEntryLineOrderByWithRelationInput[] =
  [
    { journalEntry: { entryDate: 'asc' } },
    { journalEntry: { entryNumber: 'asc' } },
    { lineOrder: 'asc' },
  ];

export type LedgerLine = Prisma.JournalEntryLineGetPayload<{
  include: typeof LEDGER_LINE_INCLUDE;
}>;

/** Minimal shape `buildLedgerMovements` needs — lets pure specs pass plain objects. */
export type LedgerLineInput = Pick<
  LedgerLine,
  'id' | 'description' | 'debit' | 'credit'
> & {
  account: Pick<
    LedgerLine['account'],
    'id' | 'code' | 'name' | 'nameEn' | 'partnerControlType'
  >;
  partner: LedgerLine['partner'];
  journalEntry: LedgerLine['journalEntry'];
};

export interface LedgerMovement {
  lineId: string;
  journalEntryId: string;
  entryNumber: string;
  entryDate: Date;
  description: string | null;
  sourceType: string | null;
  sourceId: string | null;
  referenceNumber: string | null;
  status: LedgerLine['journalEntry']['status'];
  journal: { id: string; code: string; name: string } | null;
  partner: { id: string; partnerNumber: string; name: string } | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountNameEn: string | null;
  partnerControlType: LedgerLine['account']['partnerControlType'];
  debit: number;
  credit: number;
  runningBalance: number;
}

/**
 * Opening + period movements = closing, debit-positive (debit − credit) for
 * every account type — the Trial Balance's own sign convention. Amounts
 * are rounded to cents at every step so a running balance never drifts
 * from the Trial Balance's per-account rounding.
 */
export function buildLedgerMovements(
  lines: LedgerLineInput[],
  openingBalance: number,
): {
  movements: LedgerMovement[];
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
} {
  let running = roundReportMoney(openingBalance);
  let periodDebit = 0;
  let periodCredit = 0;
  const movements = lines.map((line): LedgerMovement => {
    const debit = roundReportMoney(Number(line.debit));
    const credit = roundReportMoney(Number(line.credit));
    periodDebit += debit;
    periodCredit += credit;
    running = roundReportMoney(running + debit - credit);
    return {
      lineId: line.id,
      journalEntryId: line.journalEntry.id,
      entryNumber: line.journalEntry.entryNumber,
      entryDate: line.journalEntry.entryDate,
      description: line.description ?? line.journalEntry.description,
      sourceType: line.journalEntry.sourceType,
      sourceId: line.journalEntry.sourceId,
      referenceNumber: line.journalEntry.referenceNumber,
      status: line.journalEntry.status,
      journal: line.journalEntry.journal,
      partner: line.partner,
      accountId: line.account.id,
      accountCode: line.account.code,
      accountName: line.account.name,
      accountNameEn: line.account.nameEn,
      partnerControlType: line.account.partnerControlType,
      debit,
      credit,
      runningBalance: running,
    };
  });
  periodDebit = roundReportMoney(periodDebit);
  periodCredit = roundReportMoney(periodCredit);
  return {
    movements,
    periodDebit,
    periodCredit,
    closingBalance: roundReportMoney(
      roundReportMoney(openingBalance) + periodDebit - periodCredit,
    ),
  };
}
