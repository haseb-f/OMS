/**
 * Test-only in-memory stand-in for the Prisma calls AccountingReportsService
 * makes (journal lines, entries, COA, mappings). Lets the report specs run
 * the real service end to end on a small, fully known ledger — so every
 * statement and every cross-report reconciliation is asserted against
 * hand-computed numbers without a database. Not imported by runtime code.
 */
import type { CoaNode } from './financial-report-tree';

export interface TestEntry {
  id: string;
  entryNumber?: string;
  entryDate: string;
  sourceType: string | null;
  sourceId?: string | null;
  /** id of the entry this one reverses */
  reversalOf?: string;
  status?: 'DRAFT' | 'POSTED' | 'REVERSED';
  lines: Array<[accountId: string, debit: number, credit: number]>;
}

export interface TestLedgerConfig {
  accounts: CoaNode[];
  entries: TestEntry[];
  postingSettings?: Record<string, string | null>;
  receivingAccountIds?: string[];
  paymentMethodAccountIds?: string[];
  fiscalYears?: Array<{ id?: string; startDate: string; endDate: string }>;
  partnerControls?: Array<{
    id: string;
    partnerControlType: 'RECEIVABLE' | 'PAYABLE';
  }>;
}

type DateFilter = { lt?: Date; lte?: Date; gte?: Date; gt?: Date };
type EntryRow = {
  id: string;
  entryNumber: string;
  entryDate: Date;
  sourceType: string | null;
  sourceId?: string | null;
  status: string;
  deletedAt: null;
  reversalOfRow?: EntryRow;
  lines: Array<{ accountId: string; debit: number; credit: number }>;
};

function inDate(date: Date, filter?: DateFilter): boolean {
  if (!filter) return true;
  if (filter.lt && !(date < filter.lt)) return false;
  if (filter.lte && !(date <= filter.lte)) return false;
  if (filter.gte && !(date >= filter.gte)) return false;
  if (filter.gt && !(date > filter.gt)) return false;
  return true;
}

interface Where {
  deletedAt?: null;
  status?: string | { in: string[] };
  entryDate?: DateFilter;
  sourceType?: string | null | { not: string };
  sourceId?: string;
  reversalOfEntryId?: null;
  reversalOfEntry?: { is: Where };
  AND?: Where[];
  OR?: Where[];
  lines?: { some: { accountId: { in: string[] } } };
  [key: string]: unknown;
}

const MODELLED = new Set([
  'deletedAt',
  'status',
  'entryDate',
  'sourceType',
  'sourceId',
  'reversalOfEntryId',
  'reversalOfEntry',
  'AND',
  'OR',
  'lines',
]);

function matchEntry(entry: EntryRow, where?: Where): boolean {
  if (!where) return true;
  for (const key of Object.keys(where)) {
    // company / branch / currency scope is not modelled (never set in specs)
    if (!MODELLED.has(key) && where[key] !== undefined)
      throw new Error(`test ledger: unsupported entry filter ${key}`);
  }
  const { status, entryDate, sourceType, sourceId, AND, OR, lines } = where;
  if (sourceId !== undefined && entry.sourceId !== sourceId) return false;
  if (where.reversalOfEntryId === null && entry.reversalOfRow) return false;
  if (
    where.reversalOfEntry &&
    (!entry.reversalOfRow ||
      !matchEntry(entry.reversalOfRow, where.reversalOfEntry.is))
  )
    return false;
  if (typeof status === 'string' && entry.status !== status) return false;
  if (status && typeof status === 'object' && !status.in.includes(entry.status))
    return false;
  if (!inDate(entry.entryDate, entryDate)) return false;
  if (sourceType === null && entry.sourceType !== null) return false;
  if (typeof sourceType === 'string' && entry.sourceType !== sourceType)
    return false;
  if (
    sourceType &&
    typeof sourceType === 'object' &&
    (entry.sourceType === null || entry.sourceType === sourceType.not)
  )
    return false;
  if (AND && !AND.every((w) => matchEntry(entry, w))) return false;
  if (OR && !OR.some((w) => matchEntry(entry, w))) return false;
  if (
    lines?.some &&
    !entry.lines.some((line) =>
      lines.some.accountId.in.includes(line.accountId),
    )
  )
    return false;
  return true;
}

type LineWhere = { journalEntry?: Where; accountId?: { in: string[] } };

export function createTestLedger(config: TestLedgerConfig) {
  const entries: EntryRow[] = config.entries.map((entry, index) => ({
    id: entry.id,
    entryNumber:
      entry.entryNumber ?? `JV-${String(index + 1).padStart(4, '0')}`,
    entryDate: new Date(entry.entryDate),
    sourceType: entry.sourceType,
    sourceId: entry.sourceId ?? null,
    status: entry.status ?? 'POSTED',
    deletedAt: null,
    lines: entry.lines.map(([accountId, debit, credit]) => ({
      accountId,
      debit,
      credit,
    })),
  }));

  for (const [index, entry] of config.entries.entries()) {
    if (entry.reversalOf)
      entries[index].reversalOfRow = entries.find(
        (e) => e.id === entry.reversalOf,
      );
  }

  const lineRows = (where: LineWhere) =>
    entries
      .filter((entry) => matchEntry(entry, where.journalEntry))
      .flatMap((entry) =>
        entry.lines
          .filter(
            (line) =>
              !where.accountId?.in ||
              where.accountId.in.includes(line.accountId),
          )
          .map((line) => ({ ...line, entry })),
      );

  const settings = config.postingSettings ?? {};
  const ok = <T>(value: T) => Promise.resolve(value);

  return {
    journalEntryLine: {
      groupBy: ({ where }: { where: LineWhere }) => {
        const sums = new Map<string, { debit: number; credit: number }>();
        for (const row of lineRows(where)) {
          const sum = sums.get(row.accountId) ?? { debit: 0, credit: 0 };
          sum.debit += row.debit;
          sum.credit += row.credit;
          sums.set(row.accountId, sum);
        }
        return ok(
          [...sums.entries()].map(([accountId, sum]) => ({
            accountId,
            _sum: sum,
          })),
        );
      },
      aggregate: ({ where }: { where: LineWhere }) => {
        const rows = lineRows(where);
        return ok({
          _sum: {
            debit: rows.reduce((s, r) => s + r.debit, 0),
            credit: rows.reduce((s, r) => s + r.credit, 0),
          },
        });
      },
    },
    journalEntry: {
      findMany: ({
        where,
        take,
        skip,
        orderBy,
      }: {
        where: Where;
        take?: number;
        skip?: number;
        orderBy?: Array<Record<string, 'asc' | 'desc'>>;
      }) => {
        const rows = entries.filter((entry) => matchEntry(entry, where));
        if (orderBy) {
          const key = (row: EntryRow, field: string) => {
            const value = row[field as keyof EntryRow];
            return value instanceof Date ? value.getTime() : (value as string);
          };
          rows.sort((a, b) => {
            for (const part of orderBy) {
              const [field, dir] = Object.entries(part)[0];
              const x = key(a, field);
              const y = key(b, field);
              if (x !== y) return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
            }
            return 0;
          });
        }
        const start = skip ?? 0;
        return ok(rows.slice(start, start + (take ?? Infinity)));
      },
      count: ({ where }: { where: Where }) =>
        ok(entries.filter((entry) => matchEntry(entry, where)).length),
      findFirst: ({ where }: { where: Where }) =>
        ok(
          entries
            .filter((entry) => matchEntry(entry, where))
            .sort((a, b) => a.entryDate.getTime() - b.entryDate.getTime())[0] ??
            null,
        ),
    },
    chartOfAccount: {
      findMany: ({
        where,
      }: {
        where?: { id?: { in: string[] }; partnerControlType?: unknown };
      } = {}) => {
        let rows = config.accounts;
        const ids = where?.id?.in;
        if (ids) rows = rows.filter((a) => ids.includes(a.id));
        if (where?.partnerControlType) return ok(config.partnerControls ?? []);
        return ok(rows);
      },
    },
    postingSettings: { findFirst: () => ok(settings) },
    receivingAccount: {
      findMany: () =>
        ok(
          (config.receivingAccountIds ?? []).map((id) => ({
            chartOfAccountId: id,
          })),
        ),
    },
    paymentMethod: {
      findMany: () =>
        ok(
          (config.paymentMethodAccountIds ?? []).map((accountId) => ({
            accountId,
          })),
        ),
    },
    productCategory: { findMany: () => ok([]) },
    customerGroup: { findMany: () => ok([]) },
    supplierGroup: { findMany: () => ok([]) },
    supplierProfile: { findMany: () => ok([]) },
    fiscalYear: {
      findFirst: ({
        where,
      }: {
        where: { startDate?: DateFilter; endDate?: DateFilter };
      }) => {
        const match = (config.fiscalYears ?? [])
          .map((fy) => ({
            id: fy.id ?? `fy-${fy.startDate}`,
            startDate: new Date(fy.startDate),
            endDate: new Date(fy.endDate),
          }))
          .filter(
            (fy) =>
              inDate(fy.startDate, where.startDate) &&
              inDate(fy.endDate, where.endDate),
          )
          .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0];
        return ok(match ?? null);
      },
    },
    $queryRaw: () => ok([]),
  };
}

/** Shorthand for a COA row. */
export function coa(
  id: string,
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE',
  parentAccountId: string | null,
  allowsPosting = true,
  code = id,
): CoaNode {
  const level = parentAccountId === null ? 1 : code.length;
  return {
    id,
    code,
    name: id,
    nameEn: id,
    accountType,
    parentAccountId,
    level,
    allowsPosting,
  };
}
