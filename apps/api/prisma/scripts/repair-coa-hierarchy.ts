import 'dotenv/config';
import { AccountType, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const ROOTS = [
  { code: '1', name: 'الأصول', accountType: AccountType.ASSET },
  { code: '2', name: 'الالتزامات', accountType: AccountType.LIABILITY },
  { code: '3', name: 'حقوق الملكية', accountType: AccountType.EQUITY },
  { code: '4', name: 'الإيرادات', accountType: AccountType.REVENUE },
  { code: '5', name: 'المصروفات', accountType: AccountType.EXPENSE },
];

async function main() {
  for (const root of ROOTS) {
    await prisma.chartOfAccount.upsert({
      where: { code: root.code },
      update: {
        name: root.name,
        accountType: root.accountType,
        parentAccountId: null,
        level: 1,
        allowsPosting: false,
        isSystemAccount: true,
        deletedAt: null,
      },
      create: {
        ...root,
        parentAccountId: null,
        level: 1,
        allowsPosting: false,
        isSystemAccount: true,
      },
    });
  }

  const roots = await prisma.chartOfAccount.findMany({
    where: { code: { in: ROOTS.map((r) => r.code) } },
  });
  const byType = Object.fromEntries(roots.map((r) => [r.accountType, r]));

  const orphans = await prisma.chartOfAccount.findMany({
    where: {
      deletedAt: null,
      parentAccountId: null,
      isSystemAccount: false,
    },
  });
  let reparented = 0;
  for (const orphan of orphans) {
    const root = byType[orphan.accountType];
    if (!root) continue;
    await prisma.chartOfAccount.update({
      where: { id: orphan.id },
      data: { parentAccountId: root.id, level: 2 },
    });
    reparented += 1;
  }

  const all = await prisma.chartOfAccount.findMany({
    where: { deletedAt: null },
    select: { id: true, parentAccountId: true, isSystemAccount: true },
  });
  const byId = new Map(all.map((row) => [row.id, row]));
  const children = new Map<string, string[]>();
  for (const row of all) {
    if (!row.parentAccountId) continue;
    const list = children.get(row.parentAccountId) ?? [];
    list.push(row.id);
    children.set(row.parentAccountId, list);
  }

  for (const row of all) {
    let level = 1;
    let cursor: string | null = row.parentAccountId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      level += 1;
      cursor = byId.get(cursor)?.parentAccountId ?? null;
    }
    const childCount = children.get(row.id)?.length ?? 0;
    await prisma.chartOfAccount.update({
      where: { id: row.id },
      data: {
        level,
        allowsPosting: row.isSystemAccount ? false : childCount === 0,
      },
    });
  }

  const sample = await prisma.chartOfAccount.findMany({
    where: {
      code: { in: ['1', '2', '3', '4', '5', 'AR', 'AP', 'INV', 'REV'] },
    },
    select: {
      code: true,
      level: true,
      allowsPosting: true,
      isSystemAccount: true,
      parentAccount: { select: { code: true } },
    },
    orderBy: { code: 'asc' },
  });
  console.log(JSON.stringify({ reparented, sample }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
