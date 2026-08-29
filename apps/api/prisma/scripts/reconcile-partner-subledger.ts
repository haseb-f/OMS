/**
 * AR/AP subledger vs control-account reconciliation (read-only).
 * Usage: pnpm --filter api exec tsx prisma/scripts/reconcile-partner-subledger.ts
 */
import 'dotenv/config';
import { AccountType, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function report(
  label: string,
  accounts: { id: string; code: string; name: string }[],
) {
  if (accounts.length === 0) {
    console.log(`${label}: no candidate control accounts found`);
    return { ok: true as const, delta: 0 };
  }
  const ids = accounts.map((a) => a.id);
  const all = await prisma.journalEntryLine.aggregate({
    where: {
      accountId: { in: ids },
      journalEntry: { deletedAt: null, status: 'POSTED' },
    },
    _sum: { debit: true, credit: true },
  });
  const withPartner = await prisma.journalEntryLine.aggregate({
    where: {
      accountId: { in: ids },
      partnerId: { not: null },
      journalEntry: { deletedAt: null, status: 'POSTED' },
    },
    _sum: { debit: true, credit: true },
  });
  const control = Number(all._sum.debit ?? 0) - Number(all._sum.credit ?? 0);
  const partner =
    Number(withPartner._sum.debit ?? 0) - Number(withPartner._sum.credit ?? 0);
  const delta = Number((control - partner).toFixed(2));
  console.log(`\n${label}`);
  console.log(
    `  Accounts: ${accounts.map((a) => `${a.code} ${a.name}`).join(' | ')}`,
  );
  console.log(`  Control total (Dr-Cr): ${control}`);
  console.log(`  Partner-scoped total:  ${partner}`);
  console.log(
    `  Delta: ${delta} ${delta === 0 ? 'OK' : 'DISCREPANCY — investigate'}`,
  );
  return { ok: delta === 0, delta };
}

async function main() {
  // True trade AR/AP controls only — exclude cash, VAT, inventory noise.
  const arAccounts = await prisma.chartOfAccount.findMany({
    where: {
      deletedAt: null,
      accountType: AccountType.ASSET,
      OR: [
        { code: { equals: 'AR', mode: 'insensitive' } },
        { code: { equals: '113', mode: 'insensitive' } },
        { name: { equals: 'Accounts Receivable', mode: 'insensitive' } },
        { name: { contains: 'Accounts Receivable', mode: 'insensitive' } },
        { name: { contains: 'المدينون', mode: 'insensitive' } },
      ],
    },
    select: { id: true, code: true, name: true },
    take: 20,
  });
  const apAccounts = await prisma.chartOfAccount.findMany({
    where: {
      deletedAt: null,
      accountType: AccountType.LIABILITY,
      OR: [
        { code: { equals: 'AP', mode: 'insensitive' } },
        { code: { startsWith: '21', mode: 'insensitive' } },
        { name: { equals: 'Accounts Payable', mode: 'insensitive' } },
        { name: { contains: 'Accounts Payable', mode: 'insensitive' } },
        { name: { contains: 'الدائنون', mode: 'insensitive' } },
      ],
      NOT: [
        { code: { contains: 'VAT', mode: 'insensitive' } },
        { name: { contains: 'VAT', mode: 'insensitive' } },
        { name: { contains: 'ضريبة', mode: 'insensitive' } },
      ],
    },
    select: { id: true, code: true, name: true },
    take: 20,
  });

  const ar = await report('AR', arAccounts);
  const ap = await report('AP', apAccounts);

  // Detail orphan lines (control without partnerId) for investigation.
  for (const [label, accounts] of [
    ['AR', arAccounts],
    ['AP', apAccounts],
  ] as const) {
    if (accounts.length === 0) continue;
    const orphans = await prisma.journalEntryLine.findMany({
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        partnerId: null,
        journalEntry: { deletedAt: null, status: 'POSTED' },
      },
      select: {
        debit: true,
        credit: true,
        account: { select: { code: true } },
        journalEntry: { select: { entryNumber: true, description: true } },
      },
      take: 15,
    });
    if (orphans.length > 0) {
      console.log(`\n${label} lines missing partnerId (${orphans.length}+):`);
      for (const l of orphans) {
        console.log(
          `  ${l.journalEntry.entryNumber} ${l.account.code} Dr-Cr=${Number(l.debit) - Number(l.credit)} ${(l.journalEntry.description ?? '').slice(0, 60)}`,
        );
      }
    }
  }

  if (!ar.ok || !ap.ok) process.exitCode = 2;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
