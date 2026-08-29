/**
 * One-shot production helper: same semantics as
 * POST /chart-of-accounts/reset-to-five-roots with confirm token.
 * Requires RESET_CONFIRM=RESET_CHART_TO_FIVE_ROOTS and DATABASE_URL.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const CONFIRM = 'RESET_CHART_TO_FIVE_ROOTS';
const ROOTS = ['1', '2', '3', '4', '5'] as const;
const ROOT_NAMES: Record<string, string> = {
  ASSET: 'الأصول',
  LIABILITY: 'الالتزامات',
  EQUITY: 'حقوق الملكية',
  REVENUE: 'الإيرادات',
  EXPENSE: 'المصروفات',
};

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function usageExternal(id: string) {
  const counted = await prisma.chartOfAccount.findUnique({
    where: { id },
    select: {
      _count: {
        select: {
          paymentSourcesDefault: true,
          receivingAccounts: true,
          journalEntryLines: true,
          financialTransactionsExpense: true,
          bankTransactionsExpense: true,
          paymentMethods: true,
          customerProfilesDefaultReceivable: true,
          supplierProfilesDefaultPayable: true,
          supplierProfilesDefaultExpense: true,
          taxOutputFor: true,
          taxInputFor: true,
          postingSettingsSalesRevenue: true,
          postingSettingsCogs: true,
          postingSettingsInventory: true,
          postingSettingsAr: true,
          postingSettingsAp: true,
          postingSettingsExpense: true,
          postingSettingsSalesDiscount: true,
          postingSettingsSalesReturn: true,
          postingSettingsInventoryAdjustment: true,
          postingSettingsPurchase: true,
          postingSettingsPurchaseReturn: true,
          postingSettingsCash: true,
          postingSettingsBank: true,
          postingSettingsVatOutput: true,
          postingSettingsVatInput: true,
          postingSettingsRoundDifference: true,
          postingSettingsPurchaseDiscount: true,
          postingSettingsExchangeDifference: true,
          postingSettingsSuspense: true,
          postingSettingsRetainedEarnings: true,
          categoriesDefaultRevenue: true,
          categoriesDefaultInventory: true,
          categoriesDefaultCogs: true,
          categoriesDefaultPurchase: true,
          customerGroupsReceivable: true,
          customerGroupsRevenue: true,
          supplierGroupsPayable: true,
          supplierGroupsPurchase: true,
          journalsDefaultDebit: true,
          journalsDefaultCredit: true,
        },
      },
    },
  });
  if (!counted) return [] as { key: string; count: number }[];
  return Object.entries(counted._count)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, count }));
}

async function main() {
  const mode = process.argv[2] ?? 'preview';
  if (mode === 'apply' && process.env.RESET_CONFIRM !== CONFIRM) {
    throw new Error(`Set RESET_CONFIRM=${CONFIRM} to apply`);
  }

  const nonRoots = await prisma.chartOfAccount.findMany({
    where: { code: { notIn: [...ROOTS] } },
    select: { id: true, code: true, name: true, level: true },
    orderBy: { level: 'desc' },
  });

  const removable: typeof nonRoots = [];
  const blocked: { code: string; name: string; deps: string }[] = [];
  for (const row of nonRoots) {
    // Parent/child links among accounts being removed are not blockers
    // (same as ChartOfAccountsService.buildResetToFiveRootsPlan).
    const deps = (await usageExternal(row.id)).filter(
      (d) => d.key !== 'childAccounts',
    );
    if (deps.length === 0) removable.push(row);
    else
      blocked.push({
        code: row.code,
        name: row.name,
        deps: deps.map((d) => `${d.key}:${d.count}`).join(','),
      });
  }

  const roots = await prisma.chartOfAccount.findMany({
    where: { code: { in: [...ROOTS] }, deletedAt: null },
    select: {
      code: true,
      name: true,
      isSystemAccount: true,
      allowsPosting: true,
    },
    orderBy: { code: 'asc' },
  });

  const preview = {
    mode,
    roots,
    removableCount: removable.length,
    blockedCount: blocked.length,
    blocked,
    journalLinesTotal: await prisma.journalEntryLine.count(),
  };
  console.log(JSON.stringify(preview, null, 2));

  if (mode !== 'apply') return;
  if (blocked.length > 0) {
    throw new Error(`Blocked by ${blocked.length} account(s)`);
  }

  await prisma.$transaction(
    async (tx) => {
      for (const row of removable) {
        await tx.chartOfAccount.delete({ where: { id: row.id } });
      }
      for (const root of await tx.chartOfAccount.findMany({
        where: { code: { in: [...ROOTS] }, deletedAt: null },
      })) {
        await tx.chartOfAccount.update({
          where: { id: root.id },
          data: {
            parentAccountId: null,
            level: 1,
            allowsPosting: false,
            isSystemAccount: true,
            name: ROOT_NAMES[root.accountType] ?? root.name,
          },
        });
      }
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  const remaining = await prisma.chartOfAccount.findMany({
    where: { deletedAt: null },
    select: { code: true, name: true },
    orderBy: { code: 'asc' },
  });
  console.log(
    JSON.stringify(
      { applied: true, removed: removable.length, remaining },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
