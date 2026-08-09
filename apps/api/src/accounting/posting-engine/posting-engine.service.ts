import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { JournalEntryStatus, JournalType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingEngineService } from '../../numbering/numbering-engine.service';
import { JournalEntryActivityService } from '../../journal-entries/activities/journal-entry-activity.service';
import { AccountingPeriodsService } from '../fiscal-periods/accounting-periods.service';
import { FiscalYearsService } from '../fiscal-periods/fiscal-years.service';
import { PostingLine, PostingProvider } from './posting-provider.interface';

/**
 * Accounting Posting Engine (TASK-046) — the ONE place any business
 * document turns into a Journal Entry. Business documents never create
 * Journal Entries directly; they call `post(sourceType, sourceId, ...)`
 * here, and this engine looks up the Posting Provider registered for that
 * `sourceType` and executes it.
 *
 * This service contains ZERO business rules — no knowledge of what a
 * Sales Invoice, a Customer Receipt, or an Inventory Adjustment is, which
 * accounts they use, or how their amounts are computed. It only:
 *   1. Looks up the registered provider for `sourceType`.
 *   2. Runs the provider to get a `PostingResult` (a list of debit/credit
 *      lines against real Chart of Account ids).
 *   3. Validates the lines balance (sum debit === sum credit).
 *   4. Persists a POSTED JournalEntry + JournalEntryLines, numbered via the
 *      same NumberingEngineService every other document uses.
 *
 * Providers register themselves via `registerProvider` at module init
 * (see `PostingProvidersModule`) — this engine never imports a business
 * module, so there is no risk of it acquiring business rules by accident.
 */
/**
 * TASK-053 — which Journal (book of entry) each automatic sourceType posts
 * into. Customer Receipt/Supplier Payment simplify to the Cash Journal
 * (this codebase doesn't yet distinguish which ReceivingAccount is "cash" vs
 * "bank" at the Journal level); everything else maps to its natural type.
 * A sourceType with no entry here (or no matching Journal configured/
 * active) simply posts with no journalId — additive, never blocking.
 */
const SOURCE_TYPE_JOURNAL: Record<string, JournalType> = {
  SALES_INVOICE: JournalType.SALES,
  SALES_RETURN: JournalType.SALES,
  PURCHASE_INVOICE: JournalType.PURCHASE,
  PURCHASE_RETURN: JournalType.PURCHASE,
  CUSTOMER_RECEIPT: JournalType.CASH,
  SUPPLIER_PAYMENT: JournalType.CASH,
  INVENTORY_ADJUSTMENT: JournalType.GENERAL,
};

@Injectable()
export class PostingEngineService {
  private readonly logger = new Logger(PostingEngineService.name);
  private readonly providers = new Map<string, PostingProvider>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly activityService: JournalEntryActivityService,
    private readonly accountingPeriods: AccountingPeriodsService,
    private readonly fiscalYears: FiscalYearsService,
  ) {}

  registerProvider(provider: PostingProvider) {
    for (const sourceType of provider.sourceTypes) {
      this.providers.set(sourceType, provider);
    }
  }

  /**
   * Posts one source document. Runs inside the caller's own transaction
   * when `tx` is supplied (so the Journal Entry commits atomically with
   * the document's own status change), otherwise opens its own.
   */
  async post(
    sourceType: string,
    sourceId: string,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const provider = this.providers.get(sourceType);
    if (!provider) {
      throw new Error(
        `No Posting Provider registered for sourceType "${sourceType}".`,
      );
    }

    const run = async (client: Prisma.TransactionClient) => {
      const result = await provider.buildEntries(
        sourceType,
        sourceId,
        client,
        userId,
      );
      if (!result || result.lines.length === 0) {
        this.logger.debug(
          `Posting Provider for ${sourceType} ${sourceId} returned nothing to post.`,
        );
        return null;
      }

      this.assertBalanced(result.lines);

      const entryDate = new Date();
      await this.accountingPeriods.assertPeriodOpen(entryDate, client);
      await this.fiscalYears.assertPostingAllowed(
        entryDate,
        sourceType,
        client,
      );

      const entryNumber = await this.numberingEngine.generateNumber(
        'JOURNAL_ENTRY',
        undefined,
        client,
      );
      const { totalDebit, totalCredit } = this.computeTotals(result.lines);
      const journalId = await this.resolveJournalId(sourceType, client);
      const fiscalYearId = await this.fiscalYears.resolveFiscalYearId(
        entryDate,
        client,
      );

      const entry = await client.journalEntry.create({
        data: {
          entryNumber,
          entryDate,
          description: result.description ?? `Auto-posted from ${sourceType}`,
          status: JournalEntryStatus.POSTED,
          postedAt: new Date(),
          postedBy: userId ?? null,
          sourceType,
          sourceId,
          journalId: journalId ?? undefined,
          fiscalYearId: fiscalYearId ?? undefined,
          referenceNumber: result.referenceNumber,
          currencyId: result.currencyId ?? undefined,
          companyId: result.companyId ?? undefined,
          branchId: result.branchId ?? undefined,
          projectId: result.projectId ?? undefined,
          costCenterId: result.costCenterId ?? undefined,
          totalDebit,
          totalCredit,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
          lines: {
            create: result.lines.map((line, index) => ({
              accountId: line.accountId,
              debit: line.debit ?? 0,
              credit: line.credit ?? 0,
              description: line.description,
              lineOrder: index,
            })),
          },
        },
        include: { lines: true },
      });

      await this.activityService.log(
        entry.id,
        'ENTRY_POSTED',
        `Journal entry ${entry.entryNumber} auto-posted from ${sourceType} ${sourceId}`,
        undefined,
        client,
      );

      return entry;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * Reverses the POSTED Journal Entry created for one source document
   * (sourceType+sourceId) — creates a new POSTED entry with every line's
   * debit/credit swapped, links it back via `reversalOfEntryId`, and marks
   * the original REVERSED. Mirrors `JournalEntriesService.reverse()` but is
   * keyed by source document instead of entry id, since callers here only
   * know the document (e.g. a cancelled Customer Receipt), not its entry.
   * Returns null when nothing was ever posted for this source (e.g. a
   * zero-VAT document that produced no lines) — a no-op, not an error.
   */
  async reverse(
    sourceType: string,
    sourceId: string,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const run = async (client: Prisma.TransactionClient) => {
      const existing = await client.journalEntry.findFirst({
        where: {
          sourceType,
          sourceId,
          status: JournalEntryStatus.POSTED,
          deletedAt: null,
        },
        include: { lines: true },
      });
      if (!existing) return null;

      const reversalDate = new Date();
      await this.accountingPeriods.assertPeriodOpen(reversalDate, client);
      await this.fiscalYears.assertPostingAllowed(
        reversalDate,
        sourceType,
        client,
      );
      const entryNumber = await this.numberingEngine.generateNumber(
        'JOURNAL_ENTRY',
        undefined,
        client,
      );
      const fiscalYearId = await this.fiscalYears.resolveFiscalYearId(
        reversalDate,
        client,
      );

      const reversal = await client.journalEntry.create({
        data: {
          entryNumber,
          entryDate: reversalDate,
          description: `Reversal of ${existing.entryNumber}`,
          status: JournalEntryStatus.POSTED,
          sourceType,
          sourceId,
          journalId: existing.journalId ?? undefined,
          fiscalYearId: fiscalYearId ?? undefined,
          referenceNumber: existing.referenceNumber ?? undefined,
          currencyId: existing.currencyId ?? undefined,
          companyId: existing.companyId ?? undefined,
          branchId: existing.branchId ?? undefined,
          projectId: existing.projectId ?? undefined,
          costCenterId: existing.costCenterId ?? undefined,
          totalDebit: existing.totalCredit,
          totalCredit: existing.totalDebit,
          postedAt: new Date(),
          postedBy: userId ?? null,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
          reversalOfEntryId: existing.id,
          lines: {
            create: existing.lines.map((line, index) => ({
              accountId: line.accountId,
              description: line.description,
              debit: line.credit,
              credit: line.debit,
              lineOrder: index,
            })),
          },
        },
        include: { lines: true },
      });

      await client.journalEntry.update({
        where: { id: existing.id },
        data: {
          status: JournalEntryStatus.REVERSED,
          reversedAt: new Date(),
          reversedBy: userId ?? null,
        },
      });

      await this.activityService.log(
        existing.id,
        'ENTRY_REVERSED',
        `Journal entry ${existing.entryNumber} reversed by ${reversal.entryNumber}`,
        undefined,
        client,
      );
      await this.activityService.log(
        reversal.id,
        'ENTRY_CREATED',
        `Journal entry ${reversal.entryNumber} created as reversal of ${existing.entryNumber}`,
        undefined,
        client,
      );

      return reversal;
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /** TASK-053 — best-effort Journal classification; never blocks posting when unconfigured. */
  private async resolveJournalId(
    sourceType: string,
    client: Prisma.TransactionClient,
  ): Promise<string | null> {
    const type = SOURCE_TYPE_JOURNAL[sourceType];
    if (!type) return null;
    const journal = await client.journal.findFirst({
      where: { type, isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return journal?.id ?? null;
  }

  private computeTotals(lines: PostingLine[]) {
    return {
      totalDebit: lines.reduce((sum, l) => sum + (l.debit ?? 0), 0),
      totalCredit: lines.reduce((sum, l) => sum + (l.credit ?? 0), 0),
    };
  }

  private assertBalanced(lines: PostingLine[]) {
    const { totalDebit, totalCredit } = this.computeTotals(lines);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new BadRequestException(
        `Posting is not balanced — total debit (${totalDebit}) must equal total credit (${totalCredit}).`,
      );
    }
  }
}
