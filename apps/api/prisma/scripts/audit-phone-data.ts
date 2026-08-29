import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { isValidPhoneNumber, getCountries } from 'libphonenumber-js';

/**
 * Read-only phone/country data-quality report — safe to run against any
 * environment (never writes). Run before any normalization backfill to see
 * exactly how many existing phone values are already E.164, how many parse
 * cleanly once their row's own Country gives libphonenumber-js the right
 * region, and whether any Country.code value isn't a real ISO 3166-1
 * alpha-2 region libphonenumber-js recognizes (which would block automatic
 * normalization for rows in that country).
 *
 * Usage: pnpm --filter api run phone:audit
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function isE164(value: string | null | undefined): boolean {
  return !!value && /^\+[1-9]\d{6,14}$/.test(value);
}

async function main() {
  const SUPPORTED_REGIONS = new Set(getCountries());

  const countries = await prisma.country.findMany({
    select: { id: true, code: true, name: true },
  });
  const unrecognized = countries.filter(
    (c) => !SUPPORTED_REGIONS.has(c.code as never),
  );

  const leads = await prisma.lead.findMany({
    select: { mobileNumber: true, country: { select: { code: true } } },
  });
  const partners = await prisma.partner.findMany({
    select: { phone: true, mobile: true, country: { select: { code: true } } },
  });
  const users = await prisma.user.findMany({ select: { mobile: true } });

  function summarize(label: string, values: (string | null | undefined)[]) {
    const present = values.filter((v) => v && v.trim());
    const valid = present.filter((v) => isE164(v));
    console.log(
      `${label}: total=${values.length} present=${present.length} alreadyE164=${valid.length} notE164=${present.length - valid.length}`,
    );
  }

  function crossCheck(
    label: string,
    rows: { phone: string | null; region: string | undefined }[],
  ) {
    let checked = 0;
    let validForRegion = 0;
    const unparseable: string[] = [];
    for (const row of rows) {
      if (
        !row.phone?.trim() ||
        !row.region ||
        !SUPPORTED_REGIONS.has(row.region as never)
      )
        continue;
      checked++;
      try {
        if (isValidPhoneNumber(row.phone, row.region as never)) {
          validForRegion++;
        } else {
          unparseable.push(row.phone);
        }
      } catch {
        unparseable.push(row.phone);
      }
    }
    console.log(
      `${label}: checked=${checked} validForItsCountry=${validForRegion} needsManualReview=${unparseable.length}`,
    );
    if (unparseable.length)
      console.log(`  needs review: ${unparseable.join(', ')}`);
  }

  console.log('=== Country table ===');
  console.log(
    `total countries: ${countries.length}, unrecognized ISO2 by libphonenumber-js: ${unrecognized.length}`,
  );
  if (unrecognized.length) {
    console.log(
      '  unrecognized codes:',
      unrecognized.map((c) => `${c.code} (${c.name})`).join(', '),
    );
  }

  console.log('=== Phone field data quality (raw stored format) ===');
  summarize(
    'Lead.mobileNumber',
    leads.map((l) => l.mobileNumber),
  );
  summarize(
    'Partner.phone',
    partners.map((p) => p.phone),
  );
  summarize(
    'Partner.mobile',
    partners.map((p) => p.mobile),
  );
  summarize(
    'User.mobile',
    users.map((u) => u.mobile),
  );

  console.log(
    "=== Cross-check: valid once parsed against each row's own Country ===",
  );
  crossCheck(
    'Lead.mobileNumber',
    leads.map((l) => ({ phone: l.mobileNumber, region: l.country?.code })),
  );
  crossCheck(
    'Partner.phone',
    partners.map((p) => ({ phone: p.phone, region: p.country?.code })),
  );
}

main()
  .catch((error) => {
    console.error('ERROR:', error.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
