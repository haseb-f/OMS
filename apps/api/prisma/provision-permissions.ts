/**
 * ADR-0018 (M2 gap closure) — Production-safe permission provisioning.
 * Upserts ONLY `Permission` catalog rows (matched by unique `name`), the
 * same shape `seed.ts`'s own `ALL_PERMISSION_NAMES` loop writes. Never
 * touches Users, Departments, Job Titles, reference/master data, or grants
 * anything to anyone — deliberately narrower than `seed.ts` (which also
 * upserts demo users/reference data, unsafe to run against Production).
 * Idempotent: safe to run any number of times.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ALL_PERMISSION_NAMES } from '../src/permissions/permission-catalog';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
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
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
