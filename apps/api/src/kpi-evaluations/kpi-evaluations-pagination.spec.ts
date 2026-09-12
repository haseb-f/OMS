import { KpiEvaluationsService } from './kpi-evaluations.service';
import type { PrismaService } from '../prisma/prisma.service';

/** Phase 2 — KPI Evaluations `findAll` was previously unbounded (a plain `findMany`, no page/pageSize). */
describe('KpiEvaluationsService.findAll pagination', () => {
  const prisma = {
    kpiEvaluation: {
      findMany: jest.fn().mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]),
      count: jest.fn().mockResolvedValue(45),
    },
  };

  const service = new KpiEvaluationsService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('defaults to page 1 / pageSize 20 and returns {items, total, page, pageSize}', async () => {
    prisma.kpiEvaluation.count.mockResolvedValue(45);
    const result = await service.findAll({});
    expect(result).toEqual({
      items: [{ id: 'e1' }, { id: 'e2' }],
      total: 45,
      page: 1,
      pageSize: 20,
    });
    const call = prisma.kpiEvaluation.findMany.mock.calls.at(0) as
      [{ skip: number; take: number }] | undefined;
    expect(call?.[0].skip).toBe(0);
    expect(call?.[0].take).toBe(20);
  });

  it('computes skip/take from an explicit page/pageSize', async () => {
    await service.findAll({ page: 3, pageSize: 10 });
    const call = prisma.kpiEvaluation.findMany.mock.calls.at(0) as
      [{ skip: number; take: number }] | undefined;
    expect(call?.[0].skip).toBe(20);
    expect(call?.[0].take).toBe(10);
  });

  it('still filters by period/status/department/team/employee', async () => {
    await service.findAll({
      period: '2026-01',
      departmentId: 'd1',
      salesTeamId: 't1',
      employeeProfileId: 'emp1',
    });
    const call = prisma.kpiEvaluation.findMany.mock.calls.at(0) as
      [{ where: Record<string, unknown> }] | undefined;
    expect(call?.[0].where).toMatchObject({
      period: '2026-01',
      employeeProfileId: 'emp1',
      employeeProfile: { departmentId: 'd1', salesTeamId: 't1' },
    });
  });
});
