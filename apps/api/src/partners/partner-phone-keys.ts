import { randomUUID } from 'node:crypto';
import {
  PartnerEntityType,
  PartnerPhoneKind,
  PartnerRoleType,
  PartnerSource,
  PartnerStatus,
  Prisma,
} from '@prisma/client';
import type { PhoneNumberService } from '../common/phone/phone-number.service';
import type { NumberingEngineService } from '../numbering/numbering-engine.service';

/**
 * Owner decision O3 (2026-10-01) — one phone number = one customer.
 *
 * Every partner phone write claims the normalized E.164 numbers of the
 * partner's phone and mobile in `partner_phone_keys` (primary key = the
 * number) inside the same transaction. The claim is an
 * `INSERT … ON CONFLICT DO NOTHING`: it never aborts the surrounding
 * transaction, and a concurrent claim of the same new number waits for the
 * first one to commit and then reports its owner — so two concurrent
 * creates end with ONE partner.
 */

type Db = Prisma.TransactionClient;

/** Primary markets, in order — the fallback for a number stored without a country. */
export const PHONE_KEY_FALLBACK_REGIONS = ['SA', 'EG', 'AE'] as const;

export interface PartnerPhoneKeyInput {
  phone: string;
  kind: PartnerPhoneKind;
}

/** A number another partner already owns. */
export class PartnerPhoneInUseError extends Error {
  constructor(
    readonly phone: string,
    readonly partnerId: string,
  ) {
    super(`Phone ${phone} belongs to partner ${partnerId}.`);
  }
}

/**
 * E.164 of a stored partner number: the partner's country first, then the
 * primary markets; null when it cannot be normalized (never keyed).
 */
export function partnerPhoneKey(
  phones: PhoneNumberService,
  raw: string | null | undefined,
  countryCode?: string | null,
): string | null {
  if (!raw?.trim()) return null;
  for (const region of [countryCode, null, ...PHONE_KEY_FALLBACK_REGIONS]) {
    const e164 = phones.normalizeToE164(raw, region);
    if (e164) return e164;
  }
  return null;
}

/** The keys of a partner's phone + mobile (one row per distinct number, phone first). */
export function partnerPhoneKeys(
  phones: PhoneNumberService,
  values: { phone?: string | null; mobile?: string | null },
  countryCode?: string | null,
): PartnerPhoneKeyInput[] {
  const out: PartnerPhoneKeyInput[] = [];
  const add = (raw: string | null | undefined, kind: PartnerPhoneKind) => {
    const phone = partnerPhoneKey(phones, raw, countryCode);
    if (phone && !out.some((key) => key.phone === phone)) {
      out.push({ phone, kind });
    }
  };
  add(values.phone, PartnerPhoneKind.PHONE);
  add(values.mobile, PartnerPhoneKind.MOBILE);
  return out;
}

async function insertPhoneKey(
  db: Db,
  partnerId: string,
  key: PartnerPhoneKeyInput,
) {
  return db.$executeRaw`
    INSERT INTO "partner_phone_keys" ("phone_e164", "partner_id", "kind")
    VALUES (${key.phone}, ${partnerId}::uuid, ${key.kind}::"PartnerPhoneKind")
    ON CONFLICT ("phone_e164") DO NOTHING`;
}

/**
 * Claims `keys` for `partnerId` — always in sorted number order, so two
 * transactions claiming overlapping numbers never deadlock. Returns the
 * first number owned by another live partner (the numbers this call claimed
 * are released again), else null. A key left behind by a soft-deleted
 * partner is stale: it is removed and the number re-claimed. Re-claiming a
 * number the partner already owns is a no-op.
 */
export async function claimPartnerPhoneKeys(
  db: Db,
  partnerId: string,
  keys: PartnerPhoneKeyInput[],
): Promise<PartnerPhoneInUseError | null> {
  const claimed: string[] = [];
  const sorted = [...keys].sort((a, b) => a.phone.localeCompare(b.phone));
  for (const key of sorted) {
    let inserted = await insertPhoneKey(db, partnerId, key);
    if (inserted !== 1) {
      const stale = await db.partnerPhoneKey.deleteMany({
        where: {
          phoneE164: key.phone,
          partnerId: { not: partnerId },
          partner: { deletedAt: { not: null } },
        },
      });
      if (stale.count > 0) inserted = await insertPhoneKey(db, partnerId, key);
    }
    if (inserted === 1) {
      claimed.push(key.phone);
      continue;
    }
    const owner = await db.partnerPhoneKey.findUnique({
      where: { phoneE164: key.phone },
      select: { partnerId: true },
    });
    if (!owner || owner.partnerId === partnerId) continue;
    if (claimed.length > 0) {
      await db.partnerPhoneKey.deleteMany({
        where: { partnerId, phoneE164: { in: claimed } },
      });
    }
    return new PartnerPhoneInUseError(key.phone, owner.partnerId);
  }
  return null;
}

/** Releases the partner's keys (all of them, or only `phones`). */
export async function releasePartnerPhoneKeys(
  db: Db,
  partnerId: string,
  phones?: string[],
) {
  await db.partnerPhoneKey.deleteMany({
    where: { partnerId, ...(phones ? { phoneE164: { in: phones } } : {}) },
  });
}

/**
 * The live partner owning one of `phones`: the key owner first, then (for
 * records not keyed yet — before the backfill, or a number stored in
 * another format) the oldest partner storing the exact E.164 value.
 */
export async function findPartnerIdByPhone(
  db: Db,
  phones: string[],
  excludingId?: string,
): Promise<string | null> {
  if (phones.length === 0) return null;
  const notSelf = excludingId ? { id: { not: excludingId } } : {};
  const keyed = await db.partnerPhoneKey.findFirst({
    where: {
      phoneE164: { in: phones },
      partner: { deletedAt: null, ...notSelf },
    },
    select: { partnerId: true },
  });
  if (keyed) return keyed.partnerId;
  const stored = await db.partner.findFirst({
    where: {
      deletedAt: null,
      ...notSelf,
      OR: [{ phone: { in: phones } }, { mobile: { in: phones } }],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return stored?.id ?? null;
}

/**
 * Adds the CUSTOMER role (and profile) to a reused partner when missing —
 * the order is attached to the one record of the number whatever its other
 * roles (O3). Agent flows get no identity oracle: the match is a uniform
 * cross-scope duplicate flagged for internal review; internal Quick Create
 * keeps its explicit employee / investor guard (`useExistingWithRole`).
 */
export async function ensureCustomerRole(
  db: Db,
  partnerId: string,
  userId: string | null | undefined,
) {
  const partner = await db.partner.findUniqueOrThrow({
    where: { id: partnerId },
    select: {
      roles: { select: { role: true } },
      customerProfile: { select: { partnerId: true } },
    },
  });
  if (partner.roles.some((r) => r.role === PartnerRoleType.CUSTOMER)) return;
  await db.partnerRoleAssignment.create({
    data: {
      partnerId,
      role: PartnerRoleType.CUSTOMER,
      createdBy: userId ?? null,
    },
  });
  if (!partner.customerProfile) {
    await db.customerProfile.create({ data: { partnerId } });
  }
}

export interface CustomerPartnerInput {
  name: string;
  /** Already normalized (E.164) where possible. */
  phone?: string | null;
  mobile?: string | null;
  countryId?: string | null;
  city?: string | null;
  address?: string | null;
  source: PartnerSource;
}

/**
 * The customer behind an order inside the caller's transaction: the live
 * partner owning the phone (any scope — O3; never an archived one) is reused
 * as-is (never updated, only the CUSTOMER role is added when missing);
 * otherwise a new CUSTOMER partner is
 * created after its numbers were claimed — a concurrent create of the same
 * number resolves to the winner.
 */
export async function findOrCreateCustomerPartnerTx(
  tx: Db,
  deps: { numbering: NumberingEngineService; phones: PhoneNumberService },
  input: CustomerPartnerInput,
  userId: string | null | undefined,
): Promise<{ partnerId: string; created: boolean }> {
  const countryCode = input.countryId
    ? (
        await tx.country.findFirst({
          where: { id: input.countryId },
          select: { code: true },
        })
      )?.code
    : null;
  const keys = partnerPhoneKeys(deps.phones, input, countryCode);
  const existing = await findPartnerIdByPhone(
    tx,
    keys.map((key) => key.phone),
  );
  if (existing) {
    await ensureCustomerRole(tx, existing, userId);
    return { partnerId: existing, created: false };
  }
  const id = randomUUID();
  const conflict = await claimPartnerPhoneKeys(tx, id, keys);
  if (conflict) {
    await ensureCustomerRole(tx, conflict.partnerId, userId);
    return { partnerId: conflict.partnerId, created: false };
  }
  const partnerNumber = await deps.numbering.generateNumber(
    'PARTNER',
    undefined,
    tx,
  );
  await tx.partner.create({
    data: {
      id,
      partnerNumber,
      name: input.name,
      phone: input.phone ?? null,
      mobile: input.mobile ?? null,
      countryId: input.countryId ?? null,
      city: input.city ?? null,
      address: input.address ?? null,
      entityType: PartnerEntityType.PERSON,
      status: PartnerStatus.ACTIVE,
      source: input.source,
      createdBy: userId ?? null,
      updatedBy: userId ?? null,
    },
  });
  await tx.partnerRoleAssignment.create({
    data: {
      partnerId: id,
      role: PartnerRoleType.CUSTOMER,
      createdBy: userId ?? null,
    },
  });
  await tx.customerProfile.create({ data: { partnerId: id } });
  return { partnerId: id, created: true };
}

/**
 * Re-keys a partner whose phone / mobile changed (same transaction as the
 * partner update): numbers no longer held are released, new ones claimed.
 * Only numbers that actually changed are touched, so editing another field
 * of a legacy duplicate (an unkeyed number) never fails. A new number owned
 * by another partner → `PartnerPhoneInUseError`.
 */
export async function syncPartnerPhoneKeys(
  tx: Db,
  phones: PhoneNumberService,
  partnerId: string,
  before: { phone?: string | null; mobile?: string | null },
  after: { phone?: string | null; mobile?: string | null },
  countryCode?: string | null,
) {
  const previous = partnerPhoneKeys(phones, before, countryCode);
  const next = partnerPhoneKeys(phones, after, countryCode);
  const removed = previous
    .filter((key) => !next.some((n) => n.phone === key.phone))
    .map((key) => key.phone);
  const added = next.filter(
    (key) => !previous.some((p) => p.phone === key.phone),
  );
  if (removed.length > 0) {
    await releasePartnerPhoneKeys(tx, partnerId, removed);
  }
  const conflict = await claimPartnerPhoneKeys(tx, partnerId, added);
  if (conflict) throw conflict;
}
