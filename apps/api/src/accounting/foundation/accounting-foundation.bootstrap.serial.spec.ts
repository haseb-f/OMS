import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { activateAccountingFoundation } from './accounting-foundation.bootstrap';

/**
 * Foundation activation runs on every Vercel build (provision-permissions).
 * It must never post an accounting entry — the old phantom "OB-<year>"
 * (Dr Cash 1 / Cr Retained Earnings 1) was written whenever the current
 * year had no Opening entry. Real local Postgres (idempotent run);
 * `pnpm test:serial`.
 */
describe('activateAccountingFoundation — never posts', () => {
  jest.setTimeout(120_000);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  afterAll(() => prisma.$disconnect());

  it('creates no journal entry and reports whether a go-live opening is still needed', async () => {
    const before = await prisma.journalEntry.count();
    const openingBefore = await prisma.journalEntry.count({
      where: { sourceType: 'OPENING_BALANCE' },
    });
    const result = await activateAccountingFoundation(prisma);
    expect(await prisma.journalEntry.count()).toBe(before);
    expect(
      await prisma.journalEntry.count({
        where: { sourceType: 'OPENING_BALANCE' },
      }),
    ).toBe(openingBefore);
    expect(typeof result.openingBalanceRequired).toBe('boolean');
    // The local ledger has history / an Opening entry for the current year.
    expect(result.openingBalanceRequired).toBe(false);
  });
});
