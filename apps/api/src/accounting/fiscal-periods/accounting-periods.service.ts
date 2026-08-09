import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountingPeriodStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * TASK-051 Phase 2 — per-period Open/Close/Lock transitions. OPEN -> CLOSED
 * is reversible (Reopen). CLOSED -> LOCKED was one-way through TASK-051; a
 * genuine `unlock()` (TASK-055) exists now, gated behind
 * `accounting.fiscal-years.manage` at the controller — same permission
 * Close/Reopen/Lock already require — so "cannot reopen/unlock without
 * permission" is enforced the same way every other admin-only transition in
 * this codebase is (a permission check, not new business logic).
 *
 * `assertPeriodOpen` (TASK-052) is the ONE posting-block enforcement check —
 * both `PostingEngineService` (automatic postings) and `JournalEntriesService`
 * (manual entry Post/Reverse) call it here rather than each keeping their own
 * copy, so "no document may post into a locked period" (including a manual
 * Journal Entry, and including a Reversal) is enforced identically everywhere.
 */
@Injectable()
export class AccountingPeriodsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A date with no defined period at all is permissively allowed — this only
   * blocks posting into a period an Administrator has explicitly Closed or
   * Locked, never one nobody has set up yet. Accepts an optional transaction
   * client so callers posting atomically (Posting Engine, manual entry
   * Post/Reverse) can run this check inside their own transaction.
   */
  async assertPeriodOpen(
    entryDate: Date,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const period = await client.accountingPeriod.findFirst({
      where: { startDate: { lte: entryDate }, endDate: { gte: entryDate } },
    });
    if (!period) return;
    if (period.status !== AccountingPeriodStatus.OPEN) {
      throw new BadRequestException(
        `Cannot post — Accounting Period "${period.name}" is ${period.status}.`,
      );
    }
  }

  async findOne(id: string) {
    const period = await this.prisma.accountingPeriod.findUnique({
      where: { id },
    });
    if (!period) {
      throw new NotFoundException(`Accounting Period ${id} not found`);
    }
    return period;
  }

  async close(id: string, userId?: string) {
    const period = await this.findOne(id);
    if (period.status !== AccountingPeriodStatus.OPEN) {
      throw new BadRequestException(
        `Cannot close Accounting Period "${period.name}" — it is already ${period.status}.`,
      );
    }
    return this.prisma.accountingPeriod.update({
      where: { id },
      data: {
        status: AccountingPeriodStatus.CLOSED,
        closedAt: new Date(),
        closedBy: userId ?? null,
        updatedBy: userId ?? null,
      },
    });
  }

  async reopen(id: string, userId?: string) {
    const period = await this.findOne(id);
    if (period.status !== AccountingPeriodStatus.CLOSED) {
      throw new BadRequestException(
        period.status === AccountingPeriodStatus.LOCKED
          ? `Accounting Period "${period.name}" is Locked and can never be reopened.`
          : `Accounting Period "${period.name}" is already Open.`,
      );
    }
    return this.prisma.accountingPeriod.update({
      where: { id },
      data: {
        status: AccountingPeriodStatus.OPEN,
        closedAt: null,
        closedBy: null,
        updatedBy: userId ?? null,
      },
    });
  }

  async lock(id: string, userId?: string) {
    const period = await this.findOne(id);
    if (period.status !== AccountingPeriodStatus.CLOSED) {
      throw new BadRequestException(
        `Only a Closed period can be Locked — "${period.name}" is ${period.status}.`,
      );
    }
    return this.prisma.accountingPeriod.update({
      where: { id },
      data: {
        status: AccountingPeriodStatus.LOCKED,
        lockedAt: new Date(),
        lockedBy: userId ?? null,
        updatedBy: userId ?? null,
      },
    });
  }

  /** TASK-055 — the counterpart of `lock()`; drops back to Closed (an admin who wants it fully Open again still goes through the normal `reopen()` from there). */
  async unlock(id: string, userId?: string) {
    const period = await this.findOne(id);
    if (period.status !== AccountingPeriodStatus.LOCKED) {
      throw new BadRequestException(
        `Only a Locked period can be Unlocked — "${period.name}" is ${period.status}.`,
      );
    }
    return this.prisma.accountingPeriod.update({
      where: { id },
      data: {
        status: AccountingPeriodStatus.CLOSED,
        lockedAt: null,
        lockedBy: null,
        updatedBy: userId ?? null,
      },
    });
  }

  /**
   * Bulk Close/Bulk Open (TASK-055) — reuse `close()`/`reopen()` per id
   * rather than a second copy of their transition rules; a period already
   * in the wrong state to transition is skipped, not fatal to the batch.
   */
  async bulkClose(ids: string[], userId?: string) {
    return this.runBulk(ids, (id) => this.close(id, userId));
  }

  async bulkOpen(ids: string[], userId?: string) {
    return this.runBulk(ids, (id) => this.reopen(id, userId));
  }

  private async runBulk(
    ids: string[],
    action: (id: string) => Promise<unknown>,
  ) {
    let succeeded = 0;
    const failed: { id: string; message: string }[] = [];
    for (const id of ids) {
      try {
        await action(id);
        succeeded += 1;
      } catch (error) {
        failed.push({
          id,
          message: error instanceof Error ? error.message : 'Failed',
        });
      }
    }
    return { succeeded, failed };
  }
}
