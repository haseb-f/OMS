/**
 * M3/M4 Cost Module — temporary QA account bootstrap for the Production E2E
 * pass, same pattern as the M1/M2 QA provisioning script (removed after that
 * pass closed). Creates one clearly-labeled `QA-COST-MODULE-*` user via the
 * same Prisma calls `UsersService.create()`/`setPermissions()` make, never a
 * bypass path. `isSuperAdmin` stays `false` — access is proven entirely
 * through real `UserPermission` grants.
 *
 * Password hash comes ONLY from `QA_COSTMODULE_PASSWORD_HASH` — a
 * Production environment variable (Sensitive type, Vercel's own secret
 * store), never a literal in this file. No-ops (exits 0) if unset, so it's
 * safe to leave wired into the build pipeline only for the duration of this
 * QA pass.
 *
 * Bare PrismaClient + PrismaPg adapter with `withLibpqSslCompat` duplicated
 * inline (never an import of a decorated NestJS class) — same constraint
 * `provision-permissions.ts` documents: this runs via `ts-node` outside any
 * Nest bootstrap.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ALL_PERMISSION_NAMES,
  withImpliedSectionPermissions,
} from '../src/permissions/permission-catalog';

function withLibpqSslCompat(connectionString: string | undefined) {
  if (!connectionString || connectionString.includes('uselibpqcompat')) {
    return connectionString;
  }
  const separator = connectionString.includes('?') ? '&' : '?';
  return `${connectionString}${separator}uselibpqcompat=true`;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: withLibpqSslCompat(process.env.DATABASE_URL),
  }),
});

const QA_EMAIL = 'qa-cost-module@oms.local';
const QA_USERNAME = 'QA-COST-MODULE-ADMIN';
const QA_PERMISSIONS = [
  'store-orders.view',
  'orders.profitability.view',
  'cost-explorer.view',
  'cost-analytics.view',
  'cost-analytics.viewPnl',
  'cost-analytics.export',
  'masterdata.cost-allocation-rules.view',
  'masterdata.cost-allocation-rules.create',
  'masterdata.cost-allocation-rules.edit',
  'masterdata.cost-allocation-rules.archive',
  'masterdata.cost-allocation-rules.run',
  'masterdata.cost-allocation-rules.post',
  'masterdata.fulfillment-cost-rules.view',
  'masterdata.cost-components.view',
  'accounting.journal-entries.view',
  'accounting.chart-of-accounts.view',
  'reports.financial.view',
];

async function main() {
  const passwordHash = process.env.QA_COSTMODULE_PASSWORD_HASH;
  if (!passwordHash) {
    console.log(
      'QA_COSTMODULE_PASSWORD_HASH not set — skipping QA account provisioning (no-op).',
    );
    return;
  }

  const user = await prisma.user.upsert({
    where: { email: QA_EMAIL },
    update: {
      username: QA_USERNAME,
      fullName: 'QA Cost Module Admin (Temporary)',
      passwordHash,
      isActive: true,
      isLocked: false,
      isSuperAdmin: false,
      mustChangePassword: false,
    },
    create: {
      email: QA_EMAIL,
      username: QA_USERNAME,
      fullName: 'QA Cost Module Admin (Temporary)',
      passwordHash,
      isActive: true,
      isSuperAdmin: false,
      mustChangePassword: false,
    },
  });

  const validNames = withImpliedSectionPermissions(
    QA_PERMISSIONS.filter((name) => ALL_PERMISSION_NAMES.includes(name)),
  );
  const existing = await prisma.permission.findMany({
    where: { name: { in: validNames } },
    select: { id: true, name: true },
  });
  const existingNames = new Set(existing.map((p) => p.name));
  const missingNames = validNames.filter((name) => !existingNames.has(name));
  if (missingNames.length > 0) {
    await prisma.permission.createMany({
      data: missingNames.map((name) => ({ name })),
      skipDuplicates: true,
    });
  }
  const permissions = await prisma.permission.findMany({
    where: { name: { in: validNames } },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.userPermission.deleteMany({ where: { userId: user.id } }),
    prisma.userPermission.createMany({
      data: permissions.map((p) => ({ userId: user.id, permissionId: p.id })),
    }),
  ]);

  console.log(
    `${QA_USERNAME} provisioned: ${validNames.length} permission(s) granted.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
