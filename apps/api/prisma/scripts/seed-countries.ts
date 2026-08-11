import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getCountries, getCountryCallingCode } from 'libphonenumber-js';
import * as isoCountries from 'i18n-iso-countries';

// `require()`, not `import ... from '*.json'` — the project has no
// `resolveJsonModule` compiler option and these are CommonJS-only data
// files, not part of the app's own module graph.
// eslint-disable-next-line @typescript-eslint/no-require-imports
isoCountries.registerLocale(require('i18n-iso-countries/langs/en.json'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
isoCountries.registerLocale(require('i18n-iso-countries/langs/ar.json'));

/**
 * One-time (idempotent) full international Country dataset seed (Part 2 of
 * the Lead/Order production-fix task) — every value traces to one of two
 * authoritative, offline libraries, never hand-typed:
 *
 * - `libphonenumber-js` (`getCountries()`/`getCountryCallingCode()`) is the
 *   region list itself and the source of `callingCode` — the same library
 *   `PhoneNumberService`/`OMSPhoneInput` already validate against, so every
 *   seeded `Country.code` is guaranteed phone-metadata-complete.
 * - `i18n-iso-countries` supplies `iso3`/`numericCode` and the localized
 *   (Arabic/English) names.
 *
 * A region libphonenumber-js recognizes but `i18n-iso-countries` has no ISO
 * 3166-1 record for (e.g. `AC`/`TA` — dependent, non-standard codes) is
 * skipped outright rather than partially seeded with a fabricated code.
 *
 * Idempotent: upserts by `code` (unique) — safe to re-run, never overwrites
 * `isActive`/`defaultCurrencyId` (deliberately not in `update`, so an
 * admin's own deactivation/currency choice for a country is never
 * clobbered by a reseed), and never overwrites an already-set `name` (an
 * admin's own Arabic-name edit, or the curated names `prisma/seed.ts`
 * writes for SA/EG/AE, always wins over the library default).
 *
 * Called from `prisma/seed.ts` on every `prisma db seed` run; also runnable
 * standalone via `pnpm --filter api run seed:countries`.
 */
export async function seedCountries(
  prisma: PrismaClient,
): Promise<{
  created: number;
  updated: number;
  skipped: number;
  total: number;
}> {
  const codes = getCountries();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const code of codes) {
    const iso3 = isoCountries.alpha2ToAlpha3(code);
    const numericCode = isoCountries.alpha2ToNumeric(code);
    if (!iso3 || !numericCode) {
      skipped++;
      continue;
    }

    const nameEn = isoCountries.getName(code, 'en');
    const nameAr = isoCountries.getName(code, 'ar') ?? nameEn;
    if (!nameEn || !nameAr) {
      skipped++;
      continue;
    }

    let callingCode: string | null = null;
    try {
      callingCode = `+${getCountryCallingCode(code)}`;
    } catch {
      callingCode = null;
    }

    const existing = await prisma.country.findUnique({ where: { code } });
    await prisma.country.upsert({
      where: { code },
      update: {
        nameEn,
        iso3,
        numericCode,
        callingCode,
        ...(existing?.name ? {} : { name: nameAr }),
      },
      create: {
        code,
        name: nameAr,
        nameEn,
        iso3,
        numericCode,
        callingCode,
        isActive: true,
      },
    });
    if (existing) updated++;
    else created++;
  }

  return { created, updated, skipped, total: codes.length };
}

if (require.main === module) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  seedCountries(prisma)
    .then(({ created, updated, skipped, total }) => {
      console.log(
        `Country seed complete: created=${created} updated=${updated} skipped=${skipped} (of ${total} libphonenumber-js regions)`,
      );
    })
    .catch((error) => {
      console.error('ERROR:', error.message);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
