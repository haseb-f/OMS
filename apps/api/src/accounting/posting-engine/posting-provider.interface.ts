import { Prisma } from '@prisma/client';

/**
 * Accounting Posting Engine (TASK-046) — the only shape a Posting Provider
 * returns. Deliberately minimal: an account id and a debit OR credit
 * amount. A provider computes these from its own domain (Sales Invoice
 * totals, Financial Transaction amount, ...) — the engine never inspects
 * or second-guesses them.
 */
export interface PostingLine {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string;
}

/**
 * What a provider hands back to the engine for one source document. The
 * engine turns this directly into a JournalEntry + JournalEntryLines — it
 * adds nothing of its own except the entry number, POSTED status, and
 * audit fields.
 */
export interface PostingResult {
  lines: PostingLine[];
  description?: string;
  referenceNumber?: string;
  currencyId?: string | null;
  companyId?: string | null;
  branchId?: string | null;
  projectId?: string | null;
  costCenterId?: string | null;
}

/**
 * Each business module (Sales, Purchasing, Financial Transactions,
 * Inventory Adjustments, ...) implements one of these and registers it
 * with the `PostingEngineService`. The engine only ever calls
 * `buildEntries` — it has no knowledge of what accounts, amounts, or
 * business rules a provider used to build its `PostingResult`.
 */
export interface PostingProvider {
  /** The `sourceType` value(s) this provider handles, e.g. ['SALES_INVOICE']. */
  readonly sourceTypes: string[];

  /**
   * Returns `null` when the source document has nothing to post (e.g. a
   * zero-amount edge case) — the engine then simply creates no entry.
   * Must read everything it needs via the given transaction client so the
   * resulting entry is atomic with whatever else the caller is doing.
   */
  buildEntries(
    sourceType: string,
    sourceId: string,
    tx: Prisma.TransactionClient,
    userId?: string,
  ): Promise<PostingResult | null>;
}
