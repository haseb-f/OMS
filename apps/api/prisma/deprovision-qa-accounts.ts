/**
 * ADR-0018 (M2 gap closure) — cleanup for the temporary QA accounts created
 * by provision-qa-accounts.ts for the M1/M2 Production E2E pass. Disables
 * (never hard-deletes) both `QA-COST-E2E-*` users and revokes every
 * `UserPermission` grant they held, so the accounts stop being usable the
 * moment this runs but remain visible/auditable in Production.
 *
 * Idempotent and a no-op if the accounts don't exist (e2e pass never ran, or
 * this has already run once). Mirrors provision-qa-accounts.ts's own
 * construction (bare PrismaClient + PrismaPg adapter, withLibpqSslCompat
 * duplicated inline) for the same reason documented there.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

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

const QA_EMAILS = [
  'qa-cost-e2e-admin@oms.local',
  'qa-cost-e2e-sales@oms.local',
];

async function main() {
  for (const email of QA_EMAILS) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.log(`${email}: not found, nothing to deprovision.`);
      continue;
    }
    await prisma.userPermission.deleteMany({ where: { userId: user.id } });
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false, isLocked: true },
    });
    console.log(`${email}: disabled and permissions revoked.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
