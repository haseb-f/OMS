import { SalesTargetsService } from './sales-targets.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * An account with no linked Employee record (an owner, an integration
 * user) is a legitimate state, not a fault: `/sales-targets/me` — like
 * `/employees/me` — answers 200 with `null` so "My Profile" can render its
 * empty state without a failed request in the console.
 */
describe('SalesTargetsService.myRanking without a linked employee', () => {
  const prisma = {
    employeeProfile: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const service = new SalesTargetsService(prisma as unknown as PrismaService);

  it('returns null instead of throwing NotFound', async () => {
    await expect(service.myRanking('user-1', '2026-09')).resolves.toBeNull();
  });
});
