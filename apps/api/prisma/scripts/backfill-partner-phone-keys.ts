import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { withLibpqSslCompat } from '../libpq-ssl-compat';
import { PhoneNumberService } from '../../src/common/phone/phone-number.service';
import { backfillPartnerPhoneKeys } from '../../src/partners/partner-phone-keys-backfill';

/**
 * Owner decision O3 (2026-10-01) — one phone number = one customer.
 *
 * Keys every live partner's phone / mobile in `partner_phone_keys`
 * (normalized E.164: the partner's own country first, then SA / EG / AE).
 * Partners are visited oldest first, so the oldest record of a shared number
 * owns its key; the other records are printed as duplicate groups for
 * Finance / Sales to merge deliberately (never merged here). A number that
 * already has a key keeps its owner (a live write's claim is never moved).
 *
 * Idempotent and additive (inserts with ON CONFLICT DO NOTHING; never
 * updates or deletes a partner). Wired into scripts/vercel-build.sh as a
 * non-fatal step. Usage:
 *   pnpm --filter api exec ts-node prisma/scripts/backfill-partner-phone-keys.ts
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: withLibpqSslCompat(process.env.DATABASE_URL),
  }),
});

async function main() {
  const result = await backfillPartnerPhoneKeys(
    prisma,
    new PhoneNumberService(),
  );
  console.log(
    `partner phone keys: partners=${result.partners} inserted=${result.inserted} alreadyKeyed=${result.alreadyKeyed} withoutValidNumber=${result.withoutValidNumber} duplicateGroups=${result.duplicateGroups.length}`,
  );
  const label = (p: { partnerNumber: string; name: string } | null) =>
    p ? `${p.partnerNumber} ${p.name}` : '(unknown)';
  for (const group of result.duplicateGroups) {
    console.log(
      `  ${group.phone}: keeps ${label(group.owner)} · review ${group.others.map(label).join(' · ')}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
