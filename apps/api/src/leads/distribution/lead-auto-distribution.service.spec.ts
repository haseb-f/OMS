import { LeadDistributionMode } from '@prisma/client';
import { LeadAutoDistributionService } from './lead-auto-distribution.service';

/**
 * Unit coverage for the Round 3.1 one-action distribution control:
 * save + drain in one call, idempotent re-selection, the drain lock and
 * the empty eligible pool. The live Round Robin flow stays in
 * sales-funnel.flow.spec.ts.
 */
function policy(
  mode: LeadDistributionMode,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'policy-1',
    mode,
    isActive: true,
    deletedAt: null,
    expiresAt: null,
    teamId: null,
    departmentId: null,
    startedAt: new Date('2026-09-28T08:00:00Z'),
    ...overrides,
  };
}

function build(
  options: {
    latest?: ReturnType<typeof policy> | null;
    pending?: { id: string }[];
    eligibleUserIds?: string[];
    lockAcquired?: boolean;
    state?: Record<string, unknown> | null;
  } = {},
) {
  const latest = options.latest ?? null;
  const policyFindFirst = jest.fn(() => latest);
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn((strings: TemplateStringsArray) =>
      strings.join('').includes('pg_try_advisory_xact_lock')
        ? [{ locked: options.lockAcquired ?? true }]
        : [{ id: 'row' }],
    ),
    lead: {
      findFirst: jest.fn(() => ({
        id: 'lead',
        salesEmployeeId: null as string | null,
        distributionHeld: false,
      })),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    leadDistributionPolicy: {
      // Shared with prisma so a test can re-mock the finder once.
      findFirst: policyFindFirst,
      updateMany: jest.fn(),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({
        id: 'policy-new',
        ...data,
      })),
    },
    leadDistributionState: {
      create: jest.fn(),
      findUnique: jest.fn(() => ({
        policyId: 'policy-1',
        cursorPosition: 0,
        lastAssignedEmployeeId: null,
      })),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    leadDistributionPolicy: { findFirst: policyFindFirst },
    leadDistributionState: {
      updateMany: jest.fn(),
      findUnique: jest.fn(() => options.state ?? null),
    },
    lead: {
      findMany: jest.fn(() => options.pending ?? []),
      updateMany: jest.fn(),
      count: jest.fn(() => (options.pending ?? []).length),
      groupBy: jest.fn(() => []),
    },
    user: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, fullName: id, email: `${id}@x` })),
      ),
    },
    salesTeam: { findFirst: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  // R7 — eligibility is its own service (covered by the DB-backed matrix spec);
  // here it just supplies the Round Robin pool.
  const eligibility = {
    getEligibleIds: jest.fn(() => options.eligibleUserIds ?? []),
    evaluate: jest.fn(() => ({
      eligible: (options.eligibleUserIds ?? []).map((id) => ({
        id,
        fullName: id,
        email: `${id}@x`,
      })),
      excluded: [],
      excludedTruncated: false,
    })),
  };
  const assignments = { assign: jest.fn() };
  const service = new LeadAutoDistributionService(
    prisma as never,
    eligibility as never,
    assignments as never,
  );
  return { service, prisma, tx, assignments };
}

describe('LeadAutoDistributionService — one-action control', () => {
  it('re-selecting the effective mode keeps the policy and never double-assigns', async () => {
    const { service, tx, assignments } = build({
      latest: policy(LeadDistributionMode.CONTINUOUS),
      pending: [],
      eligibleUserIds: ['u1'],
    });
    const result = await service.applyMode({
      mode: LeadDistributionMode.CONTINUOUS,
    });
    expect(result.reused).toBe(true);
    expect(tx.leadDistributionPolicy.create).not.toHaveBeenCalled();
    expect(result.run).toEqual({
      assigned: 0,
      skipped: 0,
      failureCode: null,
      failureReason: null,
    });
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('switching to Continuous saves a new policy and drains pending leads in the same call', async () => {
    const { service, tx, assignments } = build({
      latest: policy(LeadDistributionMode.PAUSED),
      pending: [{ id: 'l1' }, { id: 'l2' }],
      eligibleUserIds: ['u1', 'u2'],
    });
    // Effective policy after the save is the new Continuous one.
    let calls = 0;
    (
      service as unknown as {
        prisma: { leadDistributionPolicy: { findFirst: jest.Mock } };
      }
    ).prisma.leadDistributionPolicy.findFirst.mockImplementation(() =>
      calls++ === 0
        ? policy(LeadDistributionMode.PAUSED)
        : policy(LeadDistributionMode.CONTINUOUS, { id: 'policy-new' }),
    );
    // Each lead reads unowned before, owned after assignment.
    let reads = 0;
    tx.lead.findFirst.mockImplementation(() => ({
      id: 'lead',
      salesEmployeeId: reads++ % 3 === 2 ? 'u1' : null,
      distributionHeld: false,
    }));

    const result = await service.applyMode({
      mode: LeadDistributionMode.CONTINUOUS,
    });
    expect(result.reused).toBe(false);
    expect(tx.leadDistributionPolicy.create).toHaveBeenCalledTimes(1);
    // The save is serialized on the policy advisory lock.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(assignments.assign).toHaveBeenCalledTimes(2);
    expect(result.run?.assigned).toBe(2);
    expect(result.run?.failureReason).toBeNull();
  });

  it('Pause saves without draining', async () => {
    const { service, prisma, assignments } = build({
      latest: policy(LeadDistributionMode.CONTINUOUS),
      pending: [{ id: 'l1' }],
      eligibleUserIds: ['u1'],
    });
    const result = await service.applyMode({
      mode: LeadDistributionMode.PAUSED,
      distributePending: false,
    });
    expect(result.run).toBeNull();
    expect(prisma.lead.findMany).not.toHaveBeenCalled();
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('a concurrent drain returns alreadyRunning without assigning', async () => {
    const { service, assignments } = build({
      latest: policy(LeadDistributionMode.CONTINUOUS),
      pending: [{ id: 'l1' }],
      eligibleUserIds: ['u1'],
      lockAcquired: false,
    });
    const run = await service.distributePending({ includeHeld: true });
    expect(run.alreadyRunning).toBe(true);
    expect(run.assigned).toBe(0);
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('an empty eligible pool holds the leads and reports NO_ELIGIBLE_EMPLOYEES', async () => {
    const { service, prisma, assignments } = build({
      latest: policy(LeadDistributionMode.CONTINUOUS),
      pending: [{ id: 'l1' }, { id: 'l2' }],
      eligibleUserIds: [],
    });
    const run = await service.distributePending({ includeHeld: true });
    expect(run).toMatchObject({
      assigned: 0,
      skipped: 2,
      failureCode: 'NO_ELIGIBLE_EMPLOYEES',
    });
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['l1', 'l2'] } },
      data: { distributionHeld: true },
    });
    expect(assignments.assign).not.toHaveBeenCalled();
  });

  it('the snapshot drops a stale empty-pool failure once the pool has members', async () => {
    const { service } = build({
      latest: policy(LeadDistributionMode.CONTINUOUS),
      eligibleUserIds: ['u1'],
      state: {
        lastRunAt: new Date(),
        lastRunAssigned: 0,
        lastFailureCode: 'NO_ELIGIBLE_EMPLOYEES',
        lastFailureMessage: 'No eligible sales employees.',
      },
    });
    const snapshot = await service.getPolicySnapshot();
    expect(snapshot.failureCode).toBeNull();
    expect(snapshot.failureReason).toBeNull();
  });

  it('the snapshot reports the empty pool while the pool is empty', async () => {
    const { service } = build({
      latest: policy(LeadDistributionMode.CONTINUOUS),
      eligibleUserIds: [],
    });
    const snapshot = await service.getPolicySnapshot();
    expect(snapshot.failureCode).toBe('NO_ELIGIBLE_EMPLOYEES');
  });
});
