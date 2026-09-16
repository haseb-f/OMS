/**
 * ADR-0018 (M2 gap closure) — temporary QA account bootstrap for the
 * M1/M2 Production E2E pass. Creates exactly two clearly-labeled
 * `QA-COST-E2E-*` users via the same Prisma calls
 * `UsersService.create()`/`setPermissions()` make, never a bypass path.
 * `isSuperAdmin` stays `false` for both — access is proven entirely
 * through real `UserPermission` grants.
 *
 * Password hashes come ONLY from `QA_ADMIN_PASSWORD_HASH` /
 * `QA_SALES_PASSWORD_HASH` — Production environment variables (Sensitive
 * type, Vercel's own secret store), never a literal in this file. The
 * script no-ops (does nothing, exits 0) if either is unset, so it is safe
 * to leave wired into the build pipeline only for the duration of the QA
 * pass and is inert everywhere else (e.g. local dev, Preview).
 *
 * Deliberately mirrors provision-permissions.ts's own construction (bare
 * PrismaClient + PrismaPg adapter with withLibpqSslCompat duplicated
 * inline, never an import of a decorated NestJS class) for the same
 * reason documented there.
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

const QA_ADMIN_EMAIL = 'qa-cost-e2e-admin@oms.local';
const QA_ADMIN_USERNAME = 'QA-COST-E2E-ADMIN';
const QA_ADMIN_PERMISSIONS = [
  'store-orders.view',
  'orders.profitability.view',
  'orders.profitability.editCosts',
  'cost-explorer.view',
  'carrier-reconciliation.view',
  'carrier-reconciliation.import',
  'carrier-reconciliation.match',
  'carrier-reconciliation.confirm',
  'masterdata.payment-sources.view',
  'masterdata.fulfillment-cost-rules.view',
  'masterdata.cost-components.view',
  'shipping.view',
];

const QA_SALES_EMAIL = 'qa-cost-e2e-sales@oms.local';
const QA_SALES_USERNAME = 'QA-COST-E2E-SALES';
const QA_SALES_PERMISSIONS = [
  'store-orders.view',
  'store-orders.create',
  'store-orders.edit',
];

async function upsertQaUser(params: {
  email: string;
  username: string;
  fullName: string;
  passwordHash: string;
  permissionNames: string[];
}): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: params.email },
    update: {
      username: params.username,
      fullName: params.fullName,
      passwordHash: params.passwordHash,
      isActive: true,
      isLocked: false,
      isSuperAdmin: false,
      mustChangePassword: false,
    },
    create: {
      email: params.email,
      username: params.username,
      fullName: params.fullName,
      passwordHash: params.passwordHash,
      isActive: true,
      isSuperAdmin: false,
      mustChangePassword: false,
    },
  });

  // Mirrors UsersService.setPermissions() exactly.
  const validNames = withImpliedSectionPermissions(
    params.permissionNames.filter((name) =>
      ALL_PERMISSION_NAMES.includes(name),
    ),
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
    `${params.username} provisioned: ${validNames.length} permission(s) granted.`,
  );
}

async function main() {
  const adminHash = process.env.QA_ADMIN_PASSWORD_HASH;
  const salesHash = process.env.QA_SALES_PASSWORD_HASH;
  if (!adminHash || !salesHash) {
    console.log(
      'QA_ADMIN_PASSWORD_HASH / QA_SALES_PASSWORD_HASH not set — skipping QA account provisioning (no-op).',
    );
    return;
  }

  await upsertQaUser({
    email: QA_ADMIN_EMAIL,
    username: QA_ADMIN_USERNAME,
    fullName: 'QA Cost Engine Admin (Temporary)',
    passwordHash: adminHash,
    permissionNames: QA_ADMIN_PERMISSIONS,
  });

  await upsertQaUser({
    email: QA_SALES_EMAIL,
    username: QA_SALES_USERNAME,
    fullName: 'QA Sales Agent (Temporary)',
    passwordHash: salesHash,
    permissionNames: QA_SALES_PERMISSIONS,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
