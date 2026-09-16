import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  AllocationDimension,
  CostAllocationMethod,
  JournalEntryStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { round2 } from '../sales/shared/sales-totals.util';
import {
  allocateProportionally,
  type AllocationBasis,
} from '../landed-cost/landed-cost-allocation.util';
import { CostAnalyticsService } from '../cost-analytics/cost-analytics.service';
import {
  CreateCostAllocationRunDto,
  ManualAllocationBasisDto,
} from './dto/create-cost-allocation-run.dto';

interface ResolvedBases {
  bases: AllocationBasis[];
  labelByKey: Map<string, string>;
  basisByKey: Map<string, number>;
}

/**
 * M4 (Cost Module completion) — activates the previously schema-only
 * `CostAllocationRule` (ADR-0014: "No calculation logic anywhere reads this
 * yet") into a real, auditable engine. A Run is a management-only ledger:
 * it NEVER creates a `JournalEntry`, never writes to `ChartOfAccount`
 * balances, and never mutates a Store Order — purely a separate reporting
 * artifact for spreading an indirect-cost pool across a chosen dimension.
 * Reuses `allocateProportionally` (Landed Cost's own deterministic
 * largest-remainder rounding, ADR-0017) rather than a second rounding
 * implementation, and `CostAnalyticsService.getProfitabilityAnalytics` for
 * automatic per-dimension weight bases — never a third way to group Order
 * economics.
 */
@Injectable()
export class CostAllocationRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: MasterDataActivityLogService,
    private readonly costAnalyticsService: CostAnalyticsService,
  ) {}

  async createRun(
    ruleId: string,
    dto: CreateCostAllocationRunDto,
    userId?: string,
  ) {
    const rule = await this.prisma.costAllocationRule.findFirst({
      where: { id: ruleId, deletedAt: null },
    });
    if (!rule) {
      throw new NotFoundException(`Cost Allocation Rule ${ruleId} not found.`);
    }
    if (!rule.isActive) {
      throw new BadRequestException('This Rule is not active.');
    }
    if (!rule.targetDimension) {
      throw new BadRequestException(
        'This Rule has no target dimension configured — edit the Rule first.',
      );
    }
    if (!dto.sourceAccountId && dto.manualPoolAmount == null) {
      throw new BadRequestException(
        'Provide either sourceAccountId (a GL Expense account) or manualPoolAmount.',
      );
    }
    if (
      rule.method === CostAllocationMethod.MANUAL &&
      (!dto.manualBases || dto.manualBases.length === 0)
    ) {
      throw new BadRequestException(
        'This Rule uses the MANUAL method — provide manualBases.',
      );
    }

    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);

    const totalAmount = dto.sourceAccountId
      ? await this.sumGlExpenseAccount(
          dto.sourceAccountId,
          periodStart,
          periodEnd,
        )
      : round2(dto.manualPoolAmount!);

    const { bases, labelByKey, basisByKey } =
      rule.method === CostAllocationMethod.MANUAL
        ? this.resolveManualBases(dto.manualBases!)
        : await this.resolveAutoBases(
            rule.targetDimension,
            rule.method,
            periodStart,
            periodEnd,
          );

    if (bases.length === 0) {
      throw new BadRequestException(
        'No dimension values were found in this period to allocate across.',
      );
    }

    const allocations = allocateProportionally(totalAmount, bases);

    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.costAllocationRun.create({
        data: {
          ruleId,
          periodStart,
          periodEnd,
          sourceAccountId: dto.sourceAccountId ?? null,
          manualPoolAmount: dto.manualPoolAmount ?? null,
          totalAmount,
          notes: dto.notes ?? null,
          createdBy: userId ?? null,
        },
      });
      await tx.costAllocationResult.createMany({
        data: allocations.map((a) => ({
          runId: created.id,
          dimensionValue: a.key,
          dimensionLabel: labelByKey.get(a.key) ?? a.key,
          basisAmount: basisByKey.get(a.key) ?? 0,
          allocatedAmount: a.amount,
        })),
      });
      return created;
    });

    await this.activityLog.log(
      'COST_ALLOCATION_RUN',
      run.id,
      'CREATED',
      `Run created (DRAFT) — total ${totalAmount}, ${bases.length} dimension value(s).`,
      userId,
    );
    return this.getRun(run.id);
  }

  /** EXPENSE-only, debit-normal — the same balance convention `AccountingReportsService` uses. */
  private async sumGlExpenseAccount(
    accountId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new NotFoundException(`Chart of Account ${accountId} not found.`);
    }
    if (account.accountType !== AccountType.EXPENSE) {
      throw new BadRequestException(
        'sourceAccountId must reference an EXPENSE account.',
      );
    }
    const agg = await this.prisma.journalEntryLine.aggregate({
      where: {
        accountId,
        journalEntry: {
          deletedAt: null,
          status: {
            in: [JournalEntryStatus.POSTED, JournalEntryStatus.REVERSED],
          },
          entryDate: { gte: from, lte: to },
        },
      },
      _sum: { debit: true, credit: true },
    });
    const debit = Number(agg._sum.debit ?? 0);
    const credit = Number(agg._sum.credit ?? 0);
    return round2(debit - credit);
  }

  private resolveManualBases(
    manualBases: ManualAllocationBasisDto[],
  ): ResolvedBases {
    return {
      bases: manualBases.map((b) => ({
        key: b.dimensionValue,
        weight: b.weight,
      })),
      labelByKey: new Map(
        manualBases.map((b) => [b.dimensionValue, b.dimensionLabel]),
      ),
      basisByKey: new Map(manualBases.map((b) => [b.dimensionValue, b.weight])),
    };
  }

  private async resolveAutoBases(
    dimension: AllocationDimension,
    method: CostAllocationMethod,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<ResolvedBases> {
    const analytics = await this.costAnalyticsService.getProfitabilityAnalytics(
      {
        dimension: dimension,
        dateFrom: periodStart.toISOString().slice(0, 10),
        dateTo: periodEnd.toISOString().slice(0, 10),
        page: 1,
        pageSize: 10_000,
      },
    );
    // UNASSIGNED (no employee/channel/country on the Order) can't receive a
    // real allocation share — excluded from weighting entirely, never
    // silently folded into another dimension value.
    const rows = analytics.rows.filter(
      (r) => r.dimensionValue !== 'UNASSIGNED',
    );
    const bases: AllocationBasis[] = rows.map((r) => ({
      key: r.dimensionValue,
      weight:
        method === CostAllocationMethod.BY_QUANTITY
          ? r.totalQuantity
          : method === CostAllocationMethod.BY_COST
            ? r.cogs
            : 1,
    }));
    return {
      bases,
      labelByKey: new Map(
        rows.map((r) => [r.dimensionValue, r.dimensionLabel]),
      ),
      basisByKey: new Map(bases.map((b) => [b.key, b.weight])),
    };
  }

  async getRun(id: string) {
    const run = await this.prisma.costAllocationRun.findUnique({
      where: { id },
      include: {
        rule: true,
        sourceAccount: true,
        results: { orderBy: { allocatedAmount: 'desc' } },
      },
    });
    if (!run) {
      throw new NotFoundException(`Cost Allocation Run ${id} not found.`);
    }
    return run;
  }

  async listRuns(ruleId?: string) {
    return this.prisma.costAllocationRun.findMany({
      where: ruleId ? { ruleId } : undefined,
      include: { rule: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async postRun(id: string, userId?: string) {
    const run = await this.getRun(id);
    if (run.status !== 'DRAFT') {
      throw new BadRequestException('Only a DRAFT Run can be posted.');
    }
    const posted = await this.prisma.costAllocationRun.update({
      where: { id },
      data: {
        status: 'POSTED',
        postedAt: new Date(),
        postedBy: userId ?? null,
      },
    });
    await this.activityLog.log(
      'COST_ALLOCATION_RUN',
      id,
      'POSTED',
      'Run posted — locked, management-reporting only, never posted to GL.',
      userId,
    );
    return posted;
  }

  async cancelRun(id: string, userId?: string) {
    const run = await this.getRun(id);
    if (run.status !== 'DRAFT') {
      throw new BadRequestException('Only a DRAFT Run can be cancelled.');
    }
    const cancelled = await this.prisma.costAllocationRun.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await this.activityLog.log(
      'COST_ALLOCATION_RUN',
      id,
      'CANCELLED',
      'Run cancelled.',
      userId,
    );
    return cancelled;
  }
}
