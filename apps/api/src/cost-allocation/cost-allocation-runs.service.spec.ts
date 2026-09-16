import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CostAllocationRunsService } from './cost-allocation-runs.service';

/**
 * M4 (Cost Module completion) — a Run must reconcile exactly (no lost
 * cent), must never be creatable from a misconfigured/inactive Rule, must
 * never post to GL, and can only transition DRAFT -> POSTED/CANCELLED once.
 */
function makeService(options: {
  rule?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
  glSum?: { debit: number; credit: number };
  analyticsRows?: {
    dimensionValue: string;
    dimensionLabel: string;
    totalQuantity: number;
    cogs: number;
  }[];
  run?: Record<string, unknown>;
}) {
  const createdResults: Record<string, unknown>[] = [];
  let lastRunCreateData: Record<string, unknown> | undefined;
  const prisma = {
    costAllocationRule: {
      findFirst: jest.fn().mockResolvedValue(
        options.rule === undefined
          ? {
              id: 'rule-1',
              method: 'EQUAL',
              targetDimension: 'CHANNEL',
              isActive: true,
            }
          : options.rule,
      ),
    },
    chartOfAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.account === undefined
            ? { id: 'acct-1', accountType: 'EXPENSE' }
            : options.account,
        ),
    },
    journalEntryLine: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: {
          debit: options.glSum?.debit ?? 100,
          credit: options.glSum?.credit ?? 0,
        },
      }),
    },
    costAllocationRun: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          lastRunCreateData = data;
          return { id: 'run-1', status: 'DRAFT', ...data };
        }),
      findUnique: jest.fn().mockResolvedValue(
        options.run ?? {
          id: 'run-1',
          status: 'DRAFT',
          results: createdResults,
        },
      ),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          id: 'run-1',
          ...data,
        })),
    },
    costAllocationResult: {
      createMany: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown>[] }) => {
          createdResults.push(...data);
          return { count: data.length };
        }),
    },
    $transaction: jest
      .fn()
      .mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
  const costAnalyticsService = {
    getProfitabilityAnalytics: jest.fn().mockResolvedValue({
      rows: options.analyticsRows ?? [
        {
          dimensionValue: 'web',
          dimensionLabel: 'web',
          totalQuantity: 3,
          cogs: 30,
        },
        {
          dimensionValue: 'phone',
          dimensionLabel: 'phone',
          totalQuantity: 1,
          cogs: 10,
        },
      ],
    }),
  };
  const service = new CostAllocationRunsService(
    prisma as never,
    activityLog as never,
    costAnalyticsService as never,
  );
  return {
    service,
    prisma,
    activityLog,
    costAnalyticsService,
    createdResults,
    getLastRunCreateData: () => lastRunCreateData,
  };
}

describe('CostAllocationRunsService.createRun — validation', () => {
  it('throws NotFoundException when the Rule does not exist', async () => {
    const { service } = makeService({ rule: null });
    await expect(
      service.createRun(
        'missing',
        {
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          manualPoolAmount: 100,
        },
        'u1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws when the Rule is inactive', async () => {
    const { service } = makeService({
      rule: {
        id: 'rule-1',
        method: 'EQUAL',
        targetDimension: 'CHANNEL',
        isActive: false,
      },
    });
    await expect(
      service.createRun(
        'rule-1',
        {
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          manualPoolAmount: 100,
        },
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when the Rule has no targetDimension configured', async () => {
    const { service } = makeService({
      rule: {
        id: 'rule-1',
        method: 'EQUAL',
        targetDimension: null,
        isActive: true,
      },
    });
    await expect(
      service.createRun(
        'rule-1',
        {
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          manualPoolAmount: 100,
        },
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when neither sourceAccountId nor manualPoolAmount is given', async () => {
    const { service } = makeService({});
    await expect(
      service.createRun(
        'rule-1',
        { periodStart: '2026-01-01', periodEnd: '2026-01-31' },
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('MANUAL method requires manualBases', async () => {
    const { service } = makeService({
      rule: {
        id: 'rule-1',
        method: 'MANUAL',
        targetDimension: 'PRODUCT',
        isActive: true,
      },
    });
    await expect(
      service.createRun(
        'rule-1',
        {
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          manualPoolAmount: 100,
        },
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a sourceAccountId that is not an EXPENSE account', async () => {
    const { service } = makeService({
      account: { id: 'acct-1', accountType: 'ASSET' },
    });
    await expect(
      service.createRun(
        'rule-1',
        {
          periodStart: '2026-01-01',
          periodEnd: '2026-01-31',
          sourceAccountId: 'acct-1',
        },
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CostAllocationRunsService.createRun — reconciliation', () => {
  it('MANUAL bases: allocated amounts reconcile exactly to the manual pool amount', async () => {
    const { service, createdResults } = makeService({
      rule: {
        id: 'rule-1',
        method: 'MANUAL',
        targetDimension: 'PRODUCT',
        isActive: true,
      },
    });

    await service.createRun(
      'rule-1',
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        manualPoolAmount: 100,
        manualBases: [
          { dimensionValue: 'p1', dimensionLabel: 'Product 1', weight: 1 },
          { dimensionValue: 'p2', dimensionLabel: 'Product 2', weight: 2 },
        ],
      },
      'u1',
    );

    const sum = createdResults.reduce(
      (s, r) => s + (r.allocatedAmount as number),
      0,
    );
    expect(Math.round(sum * 100) / 100).toBe(100);
  });

  it('auto (EQUAL) bases from CostAnalyticsService: never touches GL, reconciles exactly', async () => {
    const { service, createdResults, prisma } = makeService({
      rule: {
        id: 'rule-1',
        method: 'EQUAL',
        targetDimension: 'CHANNEL',
        isActive: true,
      },
    });

    await service.createRun(
      'rule-1',
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        manualPoolAmount: 100,
      },
      'u1',
    );

    const sum = createdResults.reduce(
      (s, r) => s + (r.allocatedAmount as number),
      0,
    );
    expect(Math.round(sum * 100) / 100).toBe(100);
    // Two channels from the mocked analytics rows, EQUAL weight — 50/50.
    expect(createdResults).toHaveLength(2);
    // No JournalEntry/GL write path exists on the Prisma mock at all —
    // asserting nothing beyond `journalEntryLine.aggregate` (a pure read,
    // only used when sourcing the pool from GL) was ever touched.
    expect(prisma.journalEntryLine.aggregate).not.toHaveBeenCalled();
  });

  it('sums debit-credit for the GL source account when sourceAccountId is given, never a manual amount', async () => {
    const { service, prisma, getLastRunCreateData } = makeService({
      glSum: { debit: 500, credit: 50 },
    });

    await service.createRun(
      'rule-1',
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        sourceAccountId: 'acct-1',
      },
      'u1',
    );

    expect(prisma.journalEntryLine.aggregate).toHaveBeenCalled();
    expect(getLastRunCreateData()?.totalAmount).toBe(450);
  });
});

describe('CostAllocationRunsService — Run lifecycle', () => {
  it('postRun only succeeds from DRAFT', async () => {
    const { service, prisma } = makeService({});
    prisma.costAllocationRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'POSTED',
    });
    await expect(service.postRun('run-1', 'u1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('cancelRun only succeeds from DRAFT', async () => {
    const { service, prisma } = makeService({});
    prisma.costAllocationRun.findUnique.mockResolvedValue({
      id: 'run-1',
      status: 'CANCELLED',
    });
    await expect(service.cancelRun('run-1', 'u1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
