import { CommissionsService } from './commissions.service';
import type { PrismaService } from '../prisma/prisma.service';

/** Phase 2 — Commissions `findAll` was previously unbounded. */
describe('CommissionsService.findAll pagination', () => {
  const prisma = {
    commissionCalculation: {
      findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]),
      count: jest.fn().mockResolvedValue(33),
    },
  };

  const service = new CommissionsService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('defaults to page 1 / pageSize 20 and returns {items, total, page, pageSize}', async () => {
    const result = await service.findAll({});
    expect(result).toEqual({
      items: [{ id: 'c1' }],
      total: 33,
      page: 1,
      pageSize: 20,
    });
    const call = prisma.commissionCalculation.findMany.mock.calls.at(0) as
      [{ skip: number; take: number }] | undefined;
    expect(call?.[0].skip).toBe(0);
    expect(call?.[0].take).toBe(20);
  });

  it('computes skip/take from an explicit page/pageSize', async () => {
    await service.findAll({ page: 2, pageSize: 15 });
    const call = prisma.commissionCalculation.findMany.mock.calls.at(0) as
      [{ skip: number; take: number }] | undefined;
    expect(call?.[0].skip).toBe(15);
    expect(call?.[0].take).toBe(15);
  });
});
