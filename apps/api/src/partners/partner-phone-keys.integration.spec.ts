import 'dotenv/config';
import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { PartnerRoleType, PartnerSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PhoneNumberService } from '../common/phone/phone-number.service';
import { PartnersService } from './partners.service';
import { findOrCreateCustomerPartnerTx } from './partner-phone-keys';
import { backfillPartnerPhoneKeys } from './partner-phone-keys-backfill';
import { resolveAgentCustomerPartner } from '../agents/orders/agent-customer';

/**
 * Owner decision O3 (2026-10-01) — one phone number = one customer, enforced
 * by `partner_phone_keys` on every partner phone write (real database).
 */
describe('O3 — partner phone keys (integration)', () => {
  jest.setTimeout(120_000);
  const tag = randomUUID().slice(0, 8);
  let seq = 0;
  const phone = () =>
    `+2012${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}${String(++seq % 100).padStart(2, '0')}`;

  let prisma: PrismaService;
  let partners: PartnersService;
  let numbering: NumberingEngineService;
  const phones = new PhoneNumberService();
  let egId: string;
  const created: string[] = [];

  const keysOf = (partnerId: string) =>
    prisma.partnerPhoneKey.findMany({ where: { partnerId } });
  const holders = (value: string) =>
    prisma.partner.findMany({
      where: { deletedAt: null, OR: [{ phone: value }, { mobile: value }] },
      select: { id: true },
    });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    numbering = new NumberingEngineService(prisma);
    partners = new PartnersService(
      prisma,
      new MasterDataActivityLogService(prisma),
      numbering,
      phones,
    );
    egId = (
      await prisma.country.findFirstOrThrow({
        where: { code: 'EG', deletedAt: null },
      })
    ).id;
  });

  afterAll(async () => {
    const ids = [
      ...created,
      ...(
        await prisma.partner.findMany({
          where: { name: { contains: tag } },
          select: { id: true },
        })
      ).map((p) => p.id),
    ];
    await prisma.customerProfile.deleteMany({
      where: { partnerId: { in: ids } },
    });
    await prisma.employeeProfile.deleteMany({
      where: { partnerId: { in: ids } },
    });
    await prisma.partnerRoleAssignment.deleteMany({
      where: { partnerId: { in: ids } },
    });
    await prisma.partner.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('create claims phone + mobile; a second create with the number reuses (find-or-create) or is refused (create)', async () => {
    const number = phone();
    const mobile = phone();
    const first = await partners.create({
      name: `Key owner ${tag}`,
      phone: number,
      mobile,
      countryId: egId,
      roles: [PartnerRoleType.CUSTOMER],
    });
    expect((await keysOf(first.id)).map((k) => k.phoneE164).sort()).toEqual(
      [number, mobile].sort(),
    );
    const again = await partners.findOrCreateWithRole({
      name: `Someone else ${tag}`,
      phone: mobile,
      countryId: egId,
      role: PartnerRoleType.CUSTOMER,
    });
    expect(again).toMatchObject({ created: false });
    expect(again.partner.id).toBe(first.id);
    await expect(
      partners.create({
        name: `Duplicate ${tag}`,
        mobile: number,
        countryId: egId,
        roles: [PartnerRoleType.CUSTOMER],
      }),
    ).rejects.toBeDefined();
    expect(await holders(number)).toHaveLength(1);
  });

  it('editing a partner phone to a number another partner holds → 409 naming it; a free number re-keys', async () => {
    const a = await partners.create({
      name: `Edit A ${tag}`,
      phone: phone(),
      countryId: egId,
      roles: [PartnerRoleType.CUSTOMER],
    });
    const b = await partners.create({
      name: `Edit B ${tag}`,
      phone: phone(),
      countryId: egId,
      roles: [PartnerRoleType.CUSTOMER],
    });
    const refused = await partners
      .update(b.id, { phone: a.phone! })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ConflictException);
    expect((refused as ConflictException).getResponse()).toMatchObject({
      code: 'PARTNER_PHONE_IN_USE',
      details: { partner: { id: a.id, name: a.name } },
    });
    const free = phone();
    await partners.update(b.id, { phone: free });
    expect((await keysOf(b.id)).map((k) => k.phoneE164)).toEqual([free]);
    // The released number is free again.
    const reuse = await partners.create({
      name: `Reuse released ${tag}`,
      phone: b.phone!,
      countryId: egId,
      roles: [PartnerRoleType.CUSTOMER],
    });
    expect((await keysOf(reuse.id)).map((k) => k.phoneE164)).toEqual([b.phone]);
  });

  it('archive releases the keys; restore re-claims them or is refused when taken', async () => {
    const number = phone();
    const archived = await partners.create({
      name: `Archived ${tag}`,
      phone: number,
      countryId: egId,
      roles: [PartnerRoleType.CUSTOMER],
    });
    await partners.archive(archived.id);
    expect(await keysOf(archived.id)).toHaveLength(0);
    const successor = await partners.create({
      name: `Successor ${tag}`,
      phone: number,
      countryId: egId,
      roles: [PartnerRoleType.CUSTOMER],
    });
    await expect(partners.restore(archived.id)).rejects.toMatchObject({
      response: { code: 'PARTNER_PHONE_IN_USE' },
    });
    await partners.archive(successor.id);
    await partners.restore(archived.id);
    expect((await keysOf(archived.id)).map((k) => k.phoneE164)).toEqual([
      number,
    ]);
  });

  it('concurrent creates of the same new number end with ONE partner (find-or-create and in-transaction paths)', async () => {
    const number = phone();
    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        partners.findOrCreateWithRole({
          name: `Race ${i} ${tag}`,
          phone: number,
          countryId: egId,
          role: PartnerRoleType.CUSTOMER,
        }),
      ),
    );
    expect(new Set(results.map((r) => r.partner.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await holders(number)).toHaveLength(1);

    const txNumber = phone();
    const ids = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        prisma.$transaction(
          (tx) =>
            findOrCreateCustomerPartnerTx(
              tx,
              { numbering, phones },
              {
                name: `Tx race ${i} ${tag}`,
                phone: txNumber,
                mobile: txNumber,
                countryId: egId,
                source: PartnerSource.API,
              },
              null,
              { agentContext: true },
            ),
          { maxWait: 30_000, timeout: 30_000 },
        ),
      ),
    );
    expect(new Set(ids.map((r) => r.partnerId)).size).toBe(1);
    expect(ids.filter((r) => r.created)).toHaveLength(1);
    expect(await holders(txNumber)).toHaveLength(1);
  });

  it('agent flows reuse the one customer of a phone (any scope) without updating it; employee identities are never extended', async () => {
    const company = await partners.create({
      name: `Company customer ${tag}`,
      phone: phone(),
      city: 'Cairo',
      countryId: egId,
      roles: [PartnerRoleType.CUSTOMER],
    });
    const reused = await prisma.$transaction((tx) =>
      resolveAgentCustomerPartner(
        tx,
        { numbering, phones },
        {
          name: `Typed by agent ${tag}`,
          mobile: company.phone!,
          countryId: egId,
          city: 'Giza',
          address: 'Agent street',
        },
      ),
    );
    expect(reused).toBe(company.id);
    const after = await prisma.partner.findUniqueOrThrow({
      where: { id: company.id },
    });
    expect(after).toMatchObject({ name: company.name, city: 'Cairo' });

    const employee = await partners.create({
      name: `Employee ${tag}`,
      phone: phone(),
      countryId: egId,
      roles: [PartnerRoleType.EMPLOYEE],
    });
    await expect(
      prisma.$transaction((tx) =>
        resolveAgentCustomerPartner(
          tx,
          { numbering, phones },
          {
            name: `Agent typed ${tag}`,
            mobile: employee.phone!,
            countryId: egId,
            city: null,
            address: null,
          },
        ),
      ),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_PHONE_UNAVAILABLE' },
    });
  });

  it('backfill: the oldest record of a shared number is keyed, the others reported; idempotent', async () => {
    const shared = phone();
    const make = (name: string, minutesAgo: number) =>
      prisma.partner.create({
        data: {
          partnerNumber: `O3-${tag}-${++seq}`,
          name: `${name} ${tag}`,
          mobile: shared,
          countryId: egId,
          createdAt: new Date(Date.now() - minutesAgo * 60_000),
        },
      });
    const newest = await make('Backfill newest', 1);
    const oldest = await make('Backfill oldest', 30);
    const middle = await make('Backfill middle', 10);
    const where = { id: { in: [newest.id, oldest.id, middle.id] } };

    const first = await backfillPartnerPhoneKeys(prisma, phones, where);
    expect(first.inserted).toBe(1);
    expect(first.duplicateGroups).toHaveLength(1);
    const [reported] = first.duplicateGroups;
    expect(reported.phone).toBe(shared);
    expect(reported.owner?.id).toBe(oldest.id);
    expect(reported.others.map((p) => p.id)).toEqual([middle.id, newest.id]);
    expect(
      await prisma.partnerPhoneKey.findUnique({ where: { phoneE164: shared } }),
    ).toMatchObject({ partnerId: oldest.id, kind: 'MOBILE' });

    const second = await backfillPartnerPhoneKeys(prisma, phones, where);
    expect(second.inserted).toBe(0);
    expect(second.duplicateGroups).toHaveLength(1);

    // The internal report lists the same group, owner marked.
    const groups = await partners.legacyPhoneDuplicateGroups();
    const group = groups.find((g) => g.phone === shared);
    expect(group?.keyOwnerId).toBe(oldest.id);
    expect(group?.partners.map((p) => p.id).sort()).toEqual(
      [newest.id, oldest.id, middle.id].sort(),
    );
    // New orders resolve to the key owner.
    expect((await partners.findByPhone(shared))?.id).toBe(oldest.id);
  });
});
