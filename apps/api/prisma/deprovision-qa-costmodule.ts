/**
 * M3/M4 Cost Module — cleanup for the temporary QA account created by
 * provision-qa-costmodule.ts for the Production E2E pass. Disables (never
 * hard-deletes) the `QA-COST-MODULE-ADMIN` user and revokes every
 * `UserPermission` grant it held. Idempotent and a no-op if the account
 * doesn't exist. Mirrors provision-qa-costmodule.ts's own construction.
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

const QA_EMAIL = 'qa-cost-module@oms.local';

async function main() {
  const user = await prisma.user.findUnique({ where: { email: QA_EMAIL } });
  if (!user) {
    console.log(`${QA_EMAIL}: not found, nothing to deprovision.`);
    return;
  }
  await prisma.userPermission.deleteMany({ where: { userId: user.id } });
  await prisma.user.update({
    where: { id: user.id },
    data: { isActive: false, isLocked: true },
  });
  console.log(`${QA_EMAIL}: disabled and permissions revoked.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
