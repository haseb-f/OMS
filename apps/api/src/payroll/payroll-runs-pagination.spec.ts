import { PayrollService } from './payroll.service';
import type { PrismaService } from '../prisma/prisma.service';

/** Phase 2 — Payroll Runs `findAll` had NO query DTO at all previously (a bare `findMany`, no filters, no pagination). */
describe('PayrollService.findAll pagination', () => {
  const prisma = {
    payrollRun: {
      findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]),
      count: jest.fn().mockResolvedValue(7),
    },
  };

  const service = new PayrollService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('defaults to page 1 / pageSize 20 and returns {items, total, page, pageSize}', async () => {
    const result = await service.findAll();
    expect(result).toEqual({
      items: [{ id: 'p1' }],
      total: 7,
      page: 1,
      pageSize: 20,
    });
    const call = prisma.payrollRun.findMany.mock.calls.at(0) as
      [{ skip: number; take: number }] | undefined;
    expect(call?.[0].skip).toBe(0);
    expect(call?.[0].take).toBe(20);
  });

  it('computes skip/take from an explicit page/pageSize and filters by status', async () => {
    await service.findAll({ page: 2, pageSize: 10, status: 'POSTED' } as never);
    const call = prisma.payrollRun.findMany.mock.calls.at(0) as
      | [{ skip: number; take: number; where: Record<string, unknown> }]
      | undefined;
    expect(call?.[0].skip).toBe(10);
    expect(call?.[0].take).toBe(10);
    expect(call?.[0].where).toEqual({ status: 'POSTED' });
  });
});
