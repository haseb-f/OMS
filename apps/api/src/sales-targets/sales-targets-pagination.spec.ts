import { SalesTargetsService } from './sales-targets.service';
import type { PrismaService } from '../prisma/prisma.service';

/** Phase 2 — Sales Targets `findAll` was previously unbounded. */
describe('SalesTargetsService.findAll pagination', () => {
  const prisma = {
    salesTarget: {
      findMany: jest.fn().mockResolvedValue([{ id: 't1' }]),
      count: jest.fn().mockResolvedValue(12),
    },
  };

  const service = new SalesTargetsService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('defaults to page 1 / pageSize 20 and returns {items, total, page, pageSize}', async () => {
    const result = await service.findAll({});
    expect(result).toEqual({
      items: [{ id: 't1' }],
      total: 12,
      page: 1,
      pageSize: 20,
    });
    const call = prisma.salesTarget.findMany.mock.calls.at(0) as
      [{ skip: number; take: number }] | undefined;
    expect(call?.[0].skip).toBe(0);
    expect(call?.[0].take).toBe(20);
  });

  it('computes skip/take from an explicit page/pageSize', async () => {
    await service.findAll({ page: 4, pageSize: 5 });
    const call = prisma.salesTarget.findMany.mock.calls.at(0) as
      [{ skip: number; take: number }] | undefined;
    expect(call?.[0].skip).toBe(15);
    expect(call?.[0].take).toBe(5);
  });
});
