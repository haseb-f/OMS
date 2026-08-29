import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JournalEntryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import {
  JournalEntryActivityService,
  JournalEntryActivityType,
} from './activities/journal-entry-activity.service';
import { AccountingPeriodsService } from '../accounting/fiscal-periods/accounting-periods.service';
import { FiscalYearsService } from '../accounting/fiscal-periods/fiscal-years.service';
import { buildDateRangeFilter } from '../sales/shared/sales-list-query.util';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto';
import { FindJournalEntriesQueryDto } from './dto/find-journal-entries-query.dto';
import { JournalEntryLineInputDto } from './dto/journal-entry-line-input.dto';
import { prismaEnumFilter } from '../common/query/enum-list';

const ENTRY_INCLUDE = {
  lines: {
    include: {
      account: true,
      costCenter: true,
      project: true,
      partner: { select: { id: true, partnerNumber: true, name: true } },
    },
    orderBy: { lineOrder: 'asc' },
  },
  journal: true,
  currency: true,
  reversalOfEntry: {
    select: { id: true, entryNumber: true },
  },
  reversedByEntry: {
    select: { id: true, entryNumber: true },
  },
} satisfies Prisma.JournalEntryInclude;

/**
 * Accounting Foundation (TASK-044 Part 6) — infrastructure only: Manual
 * Journal Entry CRUD + workflow (Draft/Post/Reverse/Archive). No Posting
 * Provider calls this automatically — every entry created here has
 * sourceType=MANUAL. Never touches Sales/Purchasing/Financial Transactions
 * tables; those modules don't know this one exists (no mappings yet, by
 * explicit instruction).
 */
@Injectable()
export class JournalEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: JournalEntryActivityService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly accountingPeriods: AccountingPeriodsService,
    private readonly fiscalYears: FiscalYearsService,
  ) {}

  async create(dto: CreateJournalEntryDto, userId?: string) {
    const resolvedLines = await this.resolveLines(dto.lines);
    const { totalDebit, totalCredit } = this.computeTotals(resolvedLines);
    this.assertBalanced(totalDebit, totalCredit);

    const entryNumber =
      await this.numberingEngine.generateNumber('JOURNAL_ENTRY');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const entry = await tx.journalEntry.create({
          data: {
            entryNumber,
            entryDate: dto.entryDate ? new Date(dto.entryDate) : undefined,
            description: dto.description,
            journalId: dto.journalId,
            currencyId: dto.currencyId,
            referenceNumber: dto.referenceNumber,
            sourceType: 'MANUAL',
            totalDebit,
            totalCredit,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
            lines: {
              create: resolvedLines.map((line, index) => ({
                ...line,
                lineOrder: index,
              })),
            },
          },
          include: ENTRY_INCLUDE,
        });
        await this.activityService.log(
          entry.id,
          JournalEntryActivityType.ENTRY_CREATED,
          `Journal entry ${entry.entryNumber} created`,
          undefined,
          tx,
        );
        return entry;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException('Invalid account reference.');
      }
      throw error;
    }
  }

  private buildFindWhere(
    query: Pick<
      FindJournalEntriesQueryDto,
      | 'status'
      | 'journalId'
      | 'sourceType'
      | 'sourceId'
      | 'search'
      | 'dateFrom'
      | 'dateTo'
    >,
  ): Prisma.JournalEntryWhereInput {
    const where: Prisma.JournalEntryWhereInput = {
      deletedAt: null,
      status: prismaEnumFilter(query.status),
      journalId: prismaEnumFilter(query.journalId),
      sourceType: query.sourceType,
      sourceId: query.sourceId,
    };
    if (query.search) {
      where.OR = [
        { entryNumber: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = buildDateRangeFilter(query.dateFrom, query.dateTo);
    }
    return where;
  }

  async findAll(query: FindJournalEntriesQueryDto) {
    const where = this.buildFindWhere(query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: ENTRY_INCLUDE,
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** "Select all matching filters" (Part 8) — bare IDs only, same filter/search as `findAll`. */
  async findAllIds(query: FindJournalEntriesQueryDto) {
    const where = this.buildFindWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        select: { id: true },
        take: 10_000,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);
    return { ids: rows.map((row) => row.id), total };
  }

  /** Bulk Archive — sequential loop over the existing single-row `archive()` (Draft-only, enforced there), same partial-failure pattern used elsewhere in the API. */
  async archiveMany(ids: string[], userId?: string) {
    const succeeded: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const id of ids) {
      try {
        await this.archive(id, userId);
        succeeded.push(id);
      } catch (error) {
        failed.push({
          id,
          message:
            error instanceof Error ? error.message : 'Failed to archive.',
        });
      }
    }
    return { succeeded, failed };
  }

  async findOne(id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, deletedAt: null },
      include: ENTRY_INCLUDE,
    });
    if (!entry) {
      throw new NotFoundException(`Journal entry ${id} not found`);
    }
    return entry;
  }

  async update(id: string, dto: UpdateJournalEntryDto, userId?: string) {
    const existing = await this.findOneById(id);
    if (existing.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft journal entry can be edited.`,
      );
    }

    const resolvedLines = dto.lines
      ? await this.resolveLines(dto.lines)
      : undefined;
    let totals: { totalDebit: number; totalCredit: number } | undefined;
    if (resolvedLines) {
      totals = this.computeTotals(resolvedLines);
      this.assertBalanced(totals.totalDebit, totals.totalCredit);
    }

    return this.prisma.$transaction(async (tx) => {
      if (resolvedLines) {
        await tx.journalEntryLine.deleteMany({
          where: { journalEntryId: id },
        });
      }
      const entry = await tx.journalEntry.update({
        where: { id },
        data: {
          entryDate: dto.entryDate ? new Date(dto.entryDate) : undefined,
          description: dto.description,
          journalId: dto.journalId,
          currencyId: dto.currencyId,
          referenceNumber: dto.referenceNumber,
          updatedBy: userId ?? null,
          ...(totals ?? {}),
          ...(resolvedLines
            ? {
                lines: {
                  create: resolvedLines.map((line, index) => ({
                    ...line,
                    lineOrder: index,
                  })),
                },
              }
            : {}),
        },
        include: ENTRY_INCLUDE,
      });
      await this.activityService.log(
        id,
        JournalEntryActivityType.ENTRY_UPDATED,
        `Journal entry ${entry.entryNumber} updated`,
        undefined,
        tx,
      );
      return entry;
    });
  }

  /** Locks the entry and makes it part of the ledger. Immutable from here on. */
  async post(id: string, userId?: string) {
    const existing = await this.findOneById(id);
    if (existing.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot post journal entry ${existing.entryNumber} from ${existing.status}.`,
      );
    }
    if (!existing.journalId) {
      throw new BadRequestException(
        `Cannot post journal entry ${existing.entryNumber} — select a Journal first.`,
      );
    }
    this.assertBalanced(
      Number(existing.totalDebit),
      Number(existing.totalCredit),
    );

    return this.prisma.$transaction(async (tx) => {
      await this.accountingPeriods.assertPeriodOpen(existing.entryDate, tx);
      await this.fiscalYears.assertPostingAllowed(
        existing.entryDate,
        existing.sourceType ?? undefined,
        tx,
      );
      const fiscalYearId = await this.fiscalYears.resolveFiscalYearId(
        existing.entryDate,
        tx,
      );

      const entry = await tx.journalEntry.update({
        where: { id },
        data: {
          status: JournalEntryStatus.POSTED,
          postedAt: new Date(),
          postedBy: userId ?? null,
          fiscalYearId: fiscalYearId ?? undefined,
        },
        include: ENTRY_INCLUDE,
      });
      await this.activityService.log(
        id,
        JournalEntryActivityType.ENTRY_POSTED,
        `Journal entry ${entry.entryNumber} posted`,
        undefined,
        tx,
      );
      return entry;
    });
  }

  /**
   * Creates a new Posted entry with every line's debit/credit swapped, links
   * it back to the original, and marks the original Reversed (terminal — the
   * original stays in the ledger untouched, it is never deleted or edited).
   */
  async reverse(id: string, userId?: string) {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { id, deletedAt: null },
      include: { lines: true },
    });
    if (!existing) {
      throw new NotFoundException(`Journal entry ${id} not found`);
    }
    if (existing.status !== JournalEntryStatus.POSTED) {
      throw new BadRequestException(
        `Cannot reverse journal entry ${existing.entryNumber} from ${existing.status}.`,
      );
    }

    const reversalNumber =
      await this.numberingEngine.generateNumber('JOURNAL_ENTRY');
    const reversalDate = new Date();

    return this.prisma.$transaction(async (tx) => {
      await this.accountingPeriods.assertPeriodOpen(reversalDate, tx);
      await this.fiscalYears.assertPostingAllowed(reversalDate, 'MANUAL', tx);
      const fiscalYearId = await this.fiscalYears.resolveFiscalYearId(
        reversalDate,
        tx,
      );

      const reversal = await tx.journalEntry.create({
        data: {
          entryNumber: reversalNumber,
          entryDate: reversalDate,
          fiscalYearId: fiscalYearId ?? undefined,
          description: `Reversal of ${existing.entryNumber}`,
          status: JournalEntryStatus.POSTED,
          sourceType: 'MANUAL',
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
              partnerId: line.partnerId ?? undefined,
              lineOrder: index,
            })),
          },
        },
        include: ENTRY_INCLUDE,
      });
      await tx.journalEntry.update({
        where: { id },
        data: {
          status: JournalEntryStatus.REVERSED,
          reversedAt: new Date(),
          reversedBy: userId ?? null,
        },
      });
      await this.activityService.log(
        id,
        JournalEntryActivityType.ENTRY_REVERSED,
        `Journal entry ${existing.entryNumber} reversed by ${reversal.entryNumber}`,
        undefined,
        tx,
      );
      await this.activityService.log(
        reversal.id,
        JournalEntryActivityType.ENTRY_CREATED,
        `Journal entry ${reversal.entryNumber} created as reversal of ${existing.entryNumber}`,
        undefined,
        tx,
      );
      return reversal;
    });
  }

  /** Soft-delete — Draft only. A Posted entry is permanent ledger history and must never be hidden via archive; use Reverse instead. */
  async archive(id: string, userId?: string) {
    const existing = await this.findOneById(id);
    if (existing.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot archive journal entry ${existing.entryNumber} while it is ${existing.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId ?? null },
        include: ENTRY_INCLUDE,
      });
      await this.activityService.log(
        id,
        JournalEntryActivityType.ENTRY_ARCHIVED,
        `Journal entry ${entry.entryNumber} archived`,
        undefined,
        tx,
      );
      return entry;
    });
  }

  /** Hard delete — Draft only. A Draft entry never reached the ledger, so unlike Archive (which only hides it) this removes it entirely; once Posted, use Archive/Reverse instead — permanent ledger history is never truly deleted. */
  async remove(id: string) {
    const existing = await this.findOneById(id);
    if (existing.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot delete journal entry ${existing.entryNumber} while it is ${existing.status}. Only Draft entries can be deleted.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.journalEntryActivity.deleteMany({
        where: { journalEntryId: id },
      });
      await tx.journalEntry.delete({ where: { id } });
    });
  }

  /**
   * Creates a new Draft entry copying this entry's journal/description/lines
   * (never its number, status, or posted/reversed audit fields) — the
   * "start a similar entry" shortcut every accountant expects, reusing the
   * exact same balance/period rules a normal Create + Post would apply.
   */
  async duplicate(id: string, userId?: string) {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { id, deletedAt: null },
      include: { lines: true },
    });
    if (!existing) {
      throw new NotFoundException(`Journal entry ${id} not found`);
    }

    const entryNumber =
      await this.numberingEngine.generateNumber('JOURNAL_ENTRY');

    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.journalEntry.create({
        data: {
          entryNumber,
          entryDate: new Date(),
          description: existing.description,
          journalId: existing.journalId,
          currencyId: existing.currencyId,
          referenceNumber: existing.referenceNumber,
          sourceType: 'MANUAL',
          totalDebit: existing.totalDebit,
          totalCredit: existing.totalCredit,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
          lines: {
            create: existing.lines.map((line, index) => ({
              accountId: line.accountId,
              description: line.description,
              costCenterId: line.costCenterId,
              projectId: line.projectId,
              debit: line.debit,
              credit: line.credit,
              partnerId: line.partnerId ?? undefined,
              lineOrder: index,
            })),
          },
        },
        include: ENTRY_INCLUDE,
      });
      await this.activityService.log(
        duplicate.id,
        JournalEntryActivityType.ENTRY_CREATED,
        `Journal entry ${duplicate.entryNumber} created as a duplicate of ${existing.entryNumber}`,
        undefined,
        tx,
      );
      return duplicate;
    });
  }

  activityFor(id: string) {
    return this.activityService.findAllForEntry(id);
  }

  private async findOneById(id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, deletedAt: null },
    });
    if (!entry) {
      throw new NotFoundException(`Journal entry ${id} not found`);
    }
    return entry;
  }

  private async resolveLines(lines: JournalEntryLineInputDto[]) {
    if (lines.length < 2) {
      throw new BadRequestException('A journal entry needs at least 2 lines.');
    }
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { id: { in: accountIds }, deletedAt: null },
      select: {
        id: true,
        allowsPosting: true,
        code: true,
        partnerControlType: true,
      },
    });
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    return lines.map((line) => {
      const account = accountById.get(line.accountId);
      if (!account) {
        throw new BadRequestException(`Account ${line.accountId} not found.`);
      }
      // A header/parent account (has children) never accepts a direct
      // posting — only leaf accounts do, set the moment an account gets its
      // first child (see ChartOfAccountsService.create()).
      if (!account.allowsPosting) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `Account ${account.code} is a header account and cannot receive direct postings.`,
          fields: [
            { field: 'accountId', constraints: ['header_account_no_posting'] },
          ],
        });
      }
      const debit = line.debit ?? 0;
      const credit = line.credit ?? 0;
      if (debit > 0 && credit > 0) {
        throw new BadRequestException(
          'A line cannot have both a debit and a credit amount.',
        );
      }
      if (debit === 0 && credit === 0) {
        throw new BadRequestException(
          'Every line needs either a debit or a credit amount.',
        );
      }
      // Unified Partner Architecture (spec section 21) — backend-enforced,
      // never left to the frontend alone: a line against a RECEIVABLE/
      // PAYABLE control account must carry a Partner.
      if (account.partnerControlType && !line.partnerId) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `Account ${account.code} requires a Partner.`,
          fields: [{ field: 'partnerId', constraints: ['partner_required'] }],
        });
      }
      return {
        accountId: line.accountId,
        description: line.description,
        costCenterId: line.costCenterId,
        projectId: line.projectId,
        partnerId: line.partnerId,
        debit,
        credit,
      };
    });
  }

  private computeTotals(lines: { debit: number; credit: number }[]) {
    return {
      totalDebit: lines.reduce((sum, l) => sum + l.debit, 0),
      totalCredit: lines.reduce((sum, l) => sum + l.credit, 0),
    };
  }

  private assertBalanced(totalDebit: number, totalCredit: number) {
    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      throw new BadRequestException(
        `Journal entry is not balanced — total debit (${totalDebit}) must equal total credit (${totalCredit}).`,
      );
    }
  }
}
