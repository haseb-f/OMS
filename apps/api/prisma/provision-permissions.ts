/**
 * ADR-0018 (M2 gap closure) — Production-safe permission provisioning.
 * Upserts ONLY `Permission` catalog rows (matched by unique `name`), the
 * same shape `seed.ts`'s own `ALL_PERMISSION_NAMES` loop writes. Never
 * touches Users, Departments, Job Titles, reference/master data, or grants
 * anything to anyone — deliberately narrower than `seed.ts` (which also
 * upserts demo users/reference data, unsafe to run against Production).
 * Idempotent: safe to run any number of times.
 *
 * Deliberately mirrors `seed.ts`'s own construction exactly: a bare
 * `PrismaClient` + `PrismaPg` adapter, never an import of `PrismaService`
 * or any other `@nestjs/common`-decorated class. This script runs via
 * `ts-node` outside any Nest bootstrap (no `reflect-metadata` polyfill,
 * no DI container) — `seed.ts` and `seed-countries.ts` are the two
 * existing, already-proven-in-this-exact-build-pipeline precedents for
 * that constraint, and neither imports a decorated class either.
 *
 * `withLibpqSslCompat` is duplicated (not imported) from
 * `src/prisma/prisma.service.ts` for the same reason — see that file's
 * own comment for why it's needed against Supabase's pooler.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ALL_PERMISSION_NAMES } from '../src/permissions/permission-catalog';
import { activateAccountingFoundation } from '../src/accounting/foundation/accounting-foundation.bootstrap';

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

async function main() {
  let created = 0;
  let existing = 0;
  for (const name of ALL_PERMISSION_NAMES) {
    const before = await prisma.permission.findUnique({ where: { name } });
    await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `Permission Matrix: ${name}` },
    });
    if (before) existing++;
    else created++;
  }
  console.log(
    `Permission catalog provisioned: ${created} created, ${existing} already existed (of ${ALL_PERMISSION_NAMES.length} total).`,
  );

  const foundation = await activateAccountingFoundation(prisma);
  console.log(
    `Accounting foundation: ${foundation.accountsCreated} accounts created, ${foundation.accountsReused} reused, settings filled [${foundation.postingSettingsFilled.join(', ')}], FY ${foundation.fiscalYear ?? 'existing'}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
