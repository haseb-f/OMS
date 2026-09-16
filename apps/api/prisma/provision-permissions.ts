/**
 * ADR-0018 (M2 gap closure) — Production-safe permission provisioning.
 * Upserts ONLY `Permission` catalog rows (matched by unique `name`), the
 * same shape `seed.ts`'s own `ALL_PERMISSION_NAMES` loop writes. Never
 * touches Users, Departments, Job Titles, reference/master data, or grants
 * anything to anyone — deliberately narrower than `seed.ts` (which also
 * upserts demo users/reference data, unsafe to run against Production).
 * Idempotent: safe to run any number of times.
 *
 * Reuses the app's own `PrismaService` (not a second hand-rolled
 * PrismaClient/adapter) specifically so it inherits `withLibpqSslCompat` —
 * without it, `@prisma/adapter-pg`'s raw `pg` driver fails the TLS
 * certificate-chain check against Supabase's pooler that `prisma migrate
 * deploy`'s own engine binary tolerates transparently.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { ALL_PERMISSION_NAMES } from '../src/permissions/permission-catalog';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
