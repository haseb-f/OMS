import 'dotenv/config';
import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ALL_PERMISSION_NAMES } from '../../src/permissions/permission-catalog';
import { withLibpqSslCompat } from '../libpq-ssl-compat';

/**
 * Permanent Production QA personas. Never disable or delete these users.
 * Password is read from QA_PASSWORD — never hardcoded, never committed.
 */
export const QA_USERS = [
  {
    email: 'qa-admin@oms.haseb.org',
    username: 'qa-admin',
    fullName: 'QA Admin',
    jobTitleName: 'مدير النظام',
    isSuperAdmin: true,
    permissions: ALL_PERMISSION_NAMES,
  },
  {
    email: 'qa-finance@oms.haseb.org',
    username: 'qa-finance',
    fullName: 'QA Finance',
    jobTitleName: 'المحاسب',
    isSuperAdmin: false,
    permissions: [
      'finance.view',
      'accounting.bank-transactions.view',
      'accounting.bank-transactions.manage',
      'accounting.chart-of-accounts.view',
      'accounting.journal-entries.view',
      'accounting.fiscal-years.manage',
      'sales.receipts.view',
      'sales.receipts.create',
      'sales.receipts.edit',
      'sales.receipts.confirm',
      'purchasing.payments.view',
      'purchasing.payments.create',
      'purchasing.payments.edit',
      'purchasing.payments.confirm',
      'accounting.expense-payments.view',
      'accounting.expense-payments.create',
      'accounting.expense-payments.edit',
      'accounting.expense-payments.confirm',
      'reports.view',
      'reports.financial.view',
      'reports.financial.print',
      'reports.financial.export',
      'cost-analytics.view',
      'cost-analytics.viewPnl',
      'store-orders.view',
      'store-orders.generate_invoice',
      'masterdata.taxes.view',
      'masterdata.payment-sources.view',
      'masterdata.receiving-accounts.view',
      'expenses.view',
      'masterdata.fixed-assets.view',
      'masterdata.fixed-assets.create',
      'masterdata.fixed-assets.edit',
      'prepaid-expenses.view',
      'prepaid-expenses.create',
      'prepaid-expenses.edit',
      'accrued-expenses.view',
      'accrued-expenses.create',
      'accrued-expenses.edit',
      'exchange-rates.view',
      'exchange-rates.create',
      'fx-revaluations.view',
      'fx-revaluations.post',
    ],
  },
  {
    email: 'qa-sales-manager@oms.haseb.org',
    username: 'qa-sales-manager',
    fullName: 'QA Sales Manager',
    jobTitleName: 'مدير المبيعات',
    isSuperAdmin: false,
    permissions: [
      'crm.view',
      'sales.view',
      'products.view',
      'products.create',
      'products.edit',
      'partners.create',
      'crm.leads.view',
      'crm.leads.create',
      'crm.leads.edit',
      'crm.leads.convert',
      'crm.leads.manage',
      'crm.leads.archive',
      'import-center.view',
      'import-center.manage',
      'import-center.export',
      'store-orders.view',
      'store-orders.create',
      'store-orders.edit',
      'sales.quotations.view',
      'sales.quotations.create',
      'sales.quotations.edit',
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.edit',
      'sales.invoices.view',
      'sales.invoices.create',
      'sales.invoices.edit',
      'customers.lookup_global',
      'orders.lookup_global',
    ],
  },
  {
    email: 'qa-sales-agent@oms.haseb.org',
    username: 'qa-sales-agent',
    fullName: 'QA Sales Agent',
    jobTitleName: 'مدير المبيعات',
    isSuperAdmin: false,
    permissions: [
      'crm.view',
      'sales.view',
      'products.view',
      'products.create',
      'products.edit',
      'partners.create',
      'crm.leads.view',
      'crm.leads.create',
      'crm.leads.edit',
      'crm.leads.convert',
      'store-orders.view',
      'store-orders.create',
      'store-orders.edit',
      'sales.quotations.view',
      'sales.quotations.create',
      'sales.quotations.edit',
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.edit',
      'sales.invoices.view',
      'sales.invoices.create',
      'sales.invoices.edit',
      'customers.lookup_global',
      'orders.lookup_global',
    ],
  },
  {
    email: 'qa-shipping@oms.haseb.org',
    username: 'qa-shipping',
    fullName: 'QA Shipping',
    jobTitleName: 'موظف الشحن',
    isSuperAdmin: false,
    permissions: [
      'store-orders.view',
      'shipping.view',
      'shipping.edit',
      'shipping.print',
      'shipping.export',
    ],
  },
] as const;

export async function ensureQaUsers(
  prisma: PrismaClient,
  password: string,
): Promise<{ email: string; created: boolean }[]> {
  if (!password || password.length < 10) {
    throw new Error('QA_PASSWORD must be set to at least 10 characters.');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const results: { email: string; created: boolean }[] = [];

  const permissions = await prisma.permission.findMany({
    select: { id: true, name: true },
  });
  const permissionByName = new Map(
    permissions.map((row) => [row.name, row.id]),
  );

  const company = await prisma.company.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const branch = company
    ? await prisma.branch.findFirst({
        where: { companyId: company.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
    : null;

  for (const persona of QA_USERS) {
    const jobTitle = await prisma.jobTitle.findFirst({
      where: { name: persona.jobTitleName },
      select: { id: true },
    });
    const byEmail = await prisma.user.findUnique({
      where: { email: persona.email },
      select: { id: true },
    });
    const byUsername = await prisma.user.findUnique({
      where: { username: persona.username },
      select: { id: true, email: true },
    });
    if (byEmail && byUsername && byEmail.id !== byUsername.id) {
      await prisma.user.update({
        where: { id: byUsername.id },
        data: {
          username: `${persona.username}-moved-${Date.now().toString().slice(-6)}`,
        },
      });
    }
    const targetId = byEmail?.id ?? byUsername?.id;
    const user = targetId
      ? await prisma.user.update({
          where: { id: targetId },
          data: {
            email: persona.email,
            username: persona.username,
            fullName: persona.fullName,
            isActive: true,
            isLocked: false,
            deletedAt: null,
            isSuperAdmin: persona.isSuperAdmin,
            jobTitleId: jobTitle?.id ?? undefined,
            passwordHash,
          },
        })
      : await prisma.user.create({
          data: {
            email: persona.email,
            username: persona.username,
            fullName: persona.fullName,
            passwordHash,
            isActive: true,
            isLocked: false,
            isSuperAdmin: persona.isSuperAdmin,
            jobTitleId: jobTitle?.id,
          },
        });
    if (company) {
      await prisma.companyMembership.upsert({
        where: {
          userId_companyId: { userId: user.id, companyId: company.id },
        },
        update: { branchId: branch?.id ?? undefined },
        create: {
          userId: user.id,
          companyId: company.id,
          branchId: branch?.id,
        },
      });
    }
    for (const name of persona.permissions) {
      const permissionId = permissionByName.get(name);
      if (!permissionId) continue;
      await prisma.userPermission.upsert({
        where: {
          userId_permissionId: { userId: user.id, permissionId },
        },
        update: {},
        create: { userId: user.id, permissionId },
      });
    }
    results.push({ email: persona.email, created: !targetId });
  }
  return results;
}

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: withLibpqSslCompat(process.env.DATABASE_URL),
    }),
  });
  try {
    const created = await ensureQaUsers(prisma, process.env.QA_PASSWORD ?? '');
    console.log(
      JSON.stringify(
        { kept: true, users: created.map((row) => row.email) },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
