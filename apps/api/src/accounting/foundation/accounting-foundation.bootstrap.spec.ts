import { findCoveringFiscalYear } from './accounting-foundation.bootstrap';

/** Foundation activation picks the current fiscal year by the Cairo business date, like the posting locks. */
describe('findCoveringFiscalYear', () => {
  const fy2025 = {
    id: 'fy-2025',
    name: 'FY 2025',
    startDate: new Date('2025-01-01T00:00:00Z'),
    endDate: new Date('2025-12-31T23:59:59.999Z'),
  };
  const fy2026 = {
    id: 'fy-2026',
    name: 'FY 2026',
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-12-31T23:59:59.999Z'),
  };
  const prisma = {
    fiscalYear: {
      findMany: jest.fn(({ where }: { where: { startDate: { lte: Date } } }) =>
        Promise.resolve(
          [fy2026, fy2025].filter((y) => y.startDate <= where.startDate.lte),
        ),
      ),
    },
  };

  it('00:30 Cairo on 1 Jan (2025-12-31T22:30Z) is FY 2026, not FY 2025', async () => {
    await expect(
      findCoveringFiscalYear(prisma as never, new Date('2025-12-31T22:30:00Z')),
    ).resolves.toMatchObject({ id: 'fy-2026' });
  });

  it('23:30 Cairo on 31 Dec (21:30Z) is still FY 2025', async () => {
    await expect(
      findCoveringFiscalYear(prisma as never, new Date('2025-12-31T21:30:00Z')),
    ).resolves.toMatchObject({ id: 'fy-2025' });
  });

  it('returns null when no fiscal year covers the date', async () => {
    await expect(
      findCoveringFiscalYear(prisma as never, new Date('2027-03-01T10:00:00Z')),
    ).resolves.toBeNull();
  });
});
