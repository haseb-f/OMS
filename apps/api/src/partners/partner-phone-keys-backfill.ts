import type { Prisma, PrismaClient } from '@prisma/client';
import type { PhoneNumberService } from '../common/phone/phone-number.service';
import { partnerPhoneKeys } from './partner-phone-keys';

/**
 * Owner decision O3 — keys existing partners' numbers in
 * `partner_phone_keys` (see prisma/scripts/backfill-partner-phone-keys.ts).
 * Oldest partner first, so the oldest record of a shared number owns its
 * key; the others are returned as duplicate groups (never merged). A number
 * that already has a key keeps its owner. Idempotent and additive.
 */
export interface PhoneKeyBackfillPartner {
  id: string;
  partnerNumber: string;
  name: string;
}

export interface PhoneKeyBackfillResult {
  partners: number;
  inserted: number;
  alreadyKeyed: number;
  withoutValidNumber: number;
  duplicateGroups: Array<{
    phone: string;
    owner: PhoneKeyBackfillPartner | null;
    others: PhoneKeyBackfillPartner[];
  }>;
}

export async function backfillPartnerPhoneKeys(
  prisma: PrismaClient,
  phones: PhoneNumberService,
  /** Narrows the run (tests); omitted = every live partner. */
  where: Prisma.PartnerWhereInput = {},
): Promise<PhoneKeyBackfillResult> {
  const partners = await prisma.partner.findMany({
    where: {
      ...where,
      deletedAt: null,
      OR: [{ phone: { not: null } }, { mobile: { not: null } }],
    },
    select: {
      id: true,
      partnerNumber: true,
      name: true,
      phone: true,
      mobile: true,
      country: { select: { code: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const keysOf = new Map(
    partners.map((partner) => [
      partner.id,
      partnerPhoneKeys(phones, partner, partner.country?.code),
    ]),
  );
  const allPhones = [...keysOf.values()].flat().map((key) => key.phone);
  const existing = await prisma.partnerPhoneKey.findMany({
    where: { phoneE164: { in: allPhones } },
    select: { phoneE164: true, partnerId: true },
  });
  const owners = new Map(existing.map((key) => [key.phoneE164, key.partnerId]));
  const byId = new Map<string, PhoneKeyBackfillPartner>(
    partners.map((p) => [p.id, p]),
  );

  let inserted = 0;
  let withoutValidNumber = 0;
  const duplicates = new Map<string, PhoneKeyBackfillPartner[]>();
  const addDuplicate = (phone: string, partner: PhoneKeyBackfillPartner) => {
    const group = duplicates.get(phone) ?? [];
    group.push(partner);
    duplicates.set(phone, group);
  };

  for (const partner of partners) {
    const keys = keysOf.get(partner.id) ?? [];
    if (keys.length === 0) {
      withoutValidNumber += 1;
      continue;
    }
    for (const key of keys) {
      const owner = owners.get(key.phone);
      if (owner === partner.id) continue;
      if (owner) {
        addDuplicate(key.phone, partner);
        continue;
      }
      const count = await prisma.$executeRaw`
        INSERT INTO "partner_phone_keys" ("phone_e164", "partner_id", "kind")
        VALUES (${key.phone}, ${partner.id}::uuid, ${key.kind}::"PartnerPhoneKind")
        ON CONFLICT ("phone_e164") DO NOTHING`;
      if (count === 1) {
        inserted += 1;
        owners.set(key.phone, partner.id);
        continue;
      }
      // Claimed concurrently by a live write — reported against that owner.
      const claimed = await prisma.partnerPhoneKey.findUnique({
        where: { phoneE164: key.phone },
        select: { partnerId: true },
      });
      if (claimed) owners.set(key.phone, claimed.partnerId);
      if (claimed && claimed.partnerId !== partner.id) {
        addDuplicate(key.phone, partner);
      }
    }
  }

  const duplicateGroups: PhoneKeyBackfillResult['duplicateGroups'] = [];
  for (const [phone, others] of duplicates) {
    const ownerId = owners.get(phone)!;
    const owner =
      byId.get(ownerId) ??
      (await prisma.partner.findUnique({
        where: { id: ownerId },
        select: { id: true, partnerNumber: true, name: true },
      }));
    duplicateGroups.push({ phone, owner, others });
  }
  return {
    partners: partners.length,
    inserted,
    alreadyKeyed: existing.length,
    withoutValidNumber,
    duplicateGroups,
  };
}
