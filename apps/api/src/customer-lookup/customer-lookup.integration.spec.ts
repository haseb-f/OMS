import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { ProductType } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { StoreOrdersModule } from '../store-orders/store-orders.module';
import { StoreOrdersService } from '../store-orders/store-orders.service';
import { PartnersModule } from '../partners/partners.module';
import { CustomerLookupModule } from './customer-lookup.module';
import { RATE_LIMIT_MAX_PER_WINDOW } from './customer-lookup.util';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../common/errors/format-validation-errors';

/**
 * R7 — `customers.lookup_advanced`: minimal disclosure, anti-enumeration and
 * agent isolation, over the real HTTP pipeline on the local Postgres.
 */
describe('Advanced customer lookup (HTTP)', () => {
  jest.setTimeout(120_000);

  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let jwt: JwtService;
  let resolver: PermissionsResolverService;
  let storeOrders: StoreOrdersService;

  const suffix = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const partnerIds: string[] = [];
  const agentIds: string[] = [];
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let categoryId: string;
  let unitId: string;
  let productId: string;
  let currencyId: string;

  // Saudi mobiles in two forms: the national form a salesperson types, and E.164.
  const phones = {
    internal: nationalAndE164(),
    agentOnly: nationalAndE164(),
    mixed: nationalAndE164(),
    missing: nationalAndE164(),
  };
  const customer = {
    internal: `R7 Lookup Internal ${suffix}`,
    agentOnly: `R7 Lookup AgentOnly ${suffix}`,
    mixed: `R7 Lookup Mixed ${suffix}`,
  };
  const order: Record<string, string> = {};
  const orderNumber: Record<string, string> = {};

  function nationalAndE164() {
    const n = `5${Math.floor(10000000 + Math.random() * 89999999)}`;
    return { national: `0${n}`, e164: `+966${n}` };
  }

  const auth = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const lookup = (who: string, query: string) =>
    request(http)
      .post('/customer-lookup/advanced')
      .set(auth(who))
      .send({ query });

  async function grant(userId: string, names: string[]) {
    for (const name of names) {
      const permission = await prisma.permission.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      await prisma.userPermission.upsert({
        where: { userId_permissionId: { userId, permissionId: permission.id } },
        update: {},
        create: { userId, permissionId: permission.id },
      });
    }
    resolver.invalidate(userId);
  }

  async function makeUser(key: string, permissionNames: string[]) {
    const user = await prisma.user.create({
      data: {
        email: `r7l-${key}-${suffix}@example.test`,
        username: `r7l-${key}-${suffix}`,
        fullName: `R7 Lookup ${key} ${suffix}`,
        passwordHash: 'x',
      },
    });
    userIds.push(user.id);
    ids[key] = user.id;
    tokens[key] = jwt.sign({ sub: user.id, email: user.email });
    await grant(user.id, permissionNames);
  }

  async function makeOrder(
    key: string,
    name: string,
    phone: string,
    owner: string | null,
    agentId: string | null,
  ) {
    const created = await storeOrders.create({
      partner: { name, phone },
      currencyId,
      items: [{ productId, quantity: 1, unitPrice: 40 }],
    });
    orderIds.push(created.id);
    order[key] = created.id;
    await prisma.shipment.deleteMany({ where: { storeOrderId: created.id } });
    const updated = await prisma.storeOrder.update({
      where: { id: created.id },
      data: { employeeId: owner, agentId },
    });
    orderNumber[key] = updated.internalOrderId;
    partnerIds.push(updated.partnerId);
    return updated;
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        PostingProvidersModule,
        PartnersModule,
        StoreOrdersModule,
        CustomerLookupModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: (errors) =>
          new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed.',
            fields: formatValidationErrors(errors),
          }),
      }),
    );
    await app.init();
    http = app.getHttpServer() as Server;
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    resolver = moduleRef.get(PermissionsResolverService);
    storeOrders = moduleRef.get(StoreOrdersService);

    currencyId = (
      await prisma.currency.findFirstOrThrow({ where: { deletedAt: null } })
    ).id;
    categoryId = (
      await prisma.productCategory.create({
        data: { name: `R7 Lookup Category ${suffix}` },
      })
    ).id;
    unitId = (
      await prisma.unit.create({ data: { name: `R7 Lookup Unit ${suffix}` } })
    ).id;
    const productName = `R7 Lookup Product ${suffix}`;
    productId = (
      await prisma.product.create({
        data: {
          name: productName,
          internalName: productName,
          displayName: productName,
          sku: `R7-LOOKUP-${suffix}`,
          categoryId,
          unitId,
          type: ProductType.SERVICE,
          isPurchasable: false,
          isSellable: true,
          isInventoryItem: false,
        },
      })
    ).id;

    // The searcher (lookup only), the order owner (lookup + own scope), a
    // user without the permission, and a user with finance/manage rights but
    // still no lookup permission (nothing implies it).
    await makeUser('searcher', ['customers.lookup_advanced']);
    // R12 tests draw on their own budget so they never shift the other tests' counts.
    await makeUser('unified', ['customers.lookup_advanced']);
    await makeUser('owner', [
      'customers.lookup_advanced',
      'customers.lookup_global',
      'orders.lookup_global',
      'store-orders.view',
      'crm.leads.view',
    ]);
    await makeUser('none', ['store-orders.view']);
    await makeUser('powerful', [
      'finance.view',
      'store-orders.manage',
      'crm.leads.manage',
      'customers.lookup_global',
      'partners.view',
    ]);
    await makeUser('rateLimited', ['customers.lookup_advanced']);
    await makeUser('rateLimitedOther', ['customers.lookup_advanced']);
    await makeUser('burst', ['customers.lookup_advanced']);
    await makeUser('globalOnly', [
      'customers.lookup_global',
      'orders.lookup_global',
      'store-orders.view',
    ]);

    const agentPartner = await prisma.partner.create({
      data: {
        name: `R7 Lookup Agent Partner ${suffix}`,
        partnerNumber: `R7L-AG-${suffix}`,
      },
    });
    partnerIds.push(agentPartner.id);
    const agent = await prisma.agent.create({
      data: {
        agentNumber: `R7L-${suffix}`,
        partnerId: agentPartner.id,
        name: `R7 Lookup Agent ${suffix}`,
        currencyId,
      },
    });
    agentIds.push(agent.id);
    ids.agent = agent.id;

    await makeOrder(
      'internal',
      customer.internal,
      phones.internal.e164,
      ids.owner,
      null,
    );
    await makeOrder(
      'agentOnly',
      customer.agentOnly,
      phones.agentOnly.e164,
      null,
      agent.id,
    );
    // Same customer served by the company AND by an agent.
    await makeOrder(
      'mixedInternal',
      customer.mixed,
      phones.mixed.e164,
      ids.owner,
      null,
    );
    await makeOrder(
      'mixedAgent',
      customer.mixed,
      phones.mixed.e164,
      null,
      agent.id,
    );
  });

  afterAll(async () => {
    await prisma.globalLookupAudit.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.shipment.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrderActivity.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrderItem.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
    const uniquePartners = [...new Set(partnerIds)];
    await prisma.partnerRoleAssignment.deleteMany({
      where: { partnerId: { in: uniquePartners } },
    });
    await prisma.customerProfile.deleteMany({
      where: { partnerId: { in: uniquePartners } },
    });
    await prisma.partnerPhoneKey.deleteMany({
      where: { partnerId: { in: uniquePartners } },
    });
    await prisma.partner.deleteMany({ where: { id: { in: uniquePartners } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.unit.deleteMany({ where: { id: unitId } });
    await prisma.productCategory.deleteMany({ where: { id: categoryId } });
    await prisma.userPermission.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await prisma.$disconnect();
    await moduleRef.close();
  });

  describe('authorization', () => {
    it('is denied (403, no data, no audit) without customers.lookup_advanced', async () => {
      const res = await lookup('none', phones.internal.national);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(customer.internal);
      const audits = await prisma.globalLookupAudit.count({
        where: { userId: ids.none },
      });
      expect(audits).toBe(0);
    });

    it('is NOT implied by finance / manage / customers.lookup_global / partners.view', async () => {
      const res = await lookup('powerful', phones.internal.national);
      expect(res.status).toBe(403);
    });

    it('never reaches an agent user, even when the underlying user holds the permission', async () => {
      const agentToken = jwt.sign({
        sub: ids.searcher,
        email: 'agent@example.test',
        typ: 'agent',
        agentId: ids.agent,
      });
      const res = await request(http)
        .post('/customer-lookup/advanced')
        .set({ Authorization: `Bearer ${agentToken}` })
        .send({ query: phones.internal.national });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain('AGENT_ACCESS_DENIED');
      expect(JSON.stringify(res.body)).not.toContain(customer.internal);
    });
  });

  describe('authorized disclosure (R14, owner decision D4-1)', () => {
    it('returns full name + phone, latest order, product summary and counts — and nothing else', async () => {
      const res = await lookup('searcher', phones.internal.national);
      expect(res.status).toBe(200);
      const body = res.body as {
        exists: boolean;
        matches: Record<string, unknown>[];
        capped: boolean;
        remainingInWindow: number;
      };
      expect(body.exists).toBe(true);
      expect(Object.keys(body).sort()).toEqual([
        'capped',
        'exists',
        'matches',
        'remainingInWindow',
      ]);
      expect(body.matches).toHaveLength(1);
      const match = body.matches[0];
      // Fixed shape — adding a field is a deliberate, reviewed change.
      expect(Object.keys(match).sort()).toEqual([
        'disclosure',
        'kind',
        'maskedPhone',
        'notAssignedToYou',
        'openable',
        'partialName',
        'previousOrders',
        'reference',
      ]);
      expect(match.kind).toBe('CUSTOMER');
      expect(match.maskedPhone).toMatch(/^\+966•+\d{3}$/);
      expect(match.maskedPhone).not.toBe(phones.internal.e164);
      expect(match.partialName).toBe(
        `R7••• Lo••• In••• ${suffix.slice(0, 2)}•••`,
      );
      expect(match.reference).toEqual({
        type: 'ORDER',
        number: orderNumber.internal,
        status: 'IN_PROGRESS',
      });
      expect(match.notAssignedToYou).toBe(true);
      // Discovery is not a link: the searcher has no scope over that order.
      expect(match.openable).toBeNull();
      // R14 — the permission holder sees the full identity and latest order.
      expect(match.disclosure).toEqual({
        name: customer.internal,
        phone: phones.internal.e164,
        latestOrder: {
          number: orderNumber.internal,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- asymmetric matcher
          orderDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          productSummary: `R7 Lookup Product ${suffix}`,
          status: 'IN_PROGRESS',
        },
        placedOrders: 1,
        completedPurchases: 0,
      });

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(ids.owner);
      expect(raw).not.toContain(order.internal);
      for (const forbidden of [
        'address',
        'city',
        'balance',
        'payment',
        'employee',
        'owner',
        'agent',
        'total',
      ]) {
        expect(raw.toLowerCase()).not.toContain(forbidden);
      }
    });

    it('lets the real owner see openable + not-flagged (the lookup adds no rights, scope does)', async () => {
      const res = await lookup('owner', phones.internal.e164);
      const match = (res.body as { matches: Record<string, unknown>[] })
        .matches[0];
      expect(match.notAssignedToYou).toBe(false);
      expect(match.openable).toEqual({ type: 'ORDER', id: order.internal });
      // …and that order really is openable by that user, the searcher still cannot.
      const open = await request(http)
        .get(`/store-orders/${order.internal}`)
        .set(auth('owner'));
      expect(open.status).toBe(200);
      const denied = await request(http)
        .get(`/store-orders/${order.internal}`)
        .set(auth('searcher'));
      expect([403, 404]).toContain(denied.status);
    });

    it('finds by a name fragment (>= 3 letters) with the same shape', async () => {
      const res = await lookup('searcher', `Lookup Internal ${suffix}`);
      expect(res.status).toBe(200);
      const body = res.body as {
        matches: { disclosure: { name: string } }[];
      };
      expect(body.matches.length).toBeGreaterThanOrEqual(1);
      expect(body.matches[0].disclosure.name).toBe(customer.internal);
    });

    it('audits every disclosing lookup as FULL_DISCLOSURE', async () => {
      const before = new Date();
      await lookup('searcher', phones.internal.national);
      const row = await prisma.globalLookupAudit.findFirst({
        where: {
          userId: ids.searcher,
          outcome: 'MATCH',
          createdAt: { gte: before },
        },
      });
      expect(row?.outcomeDetail).toBe('FULL_DISCLOSURE');
    });
  });

  describe('R12 unified lookup: previous orders and document numbers', () => {
    it('lists previous orders only for records the caller can already open', async () => {
      const mine = await lookup('owner', phones.internal.e164);
      const ownMatch = (
        mine.body as {
          matches: { previousOrders: { id: string; number: string }[] }[];
        }
      ).matches[0];
      expect(ownMatch.previousOrders.map((o) => o.id)).toContain(
        order.internal,
      );
      expect(ownMatch.previousOrders[0].number).toBe(orderNumber.internal);

      const other = await lookup('unified', phones.internal.e164);
      const otherMatch = (
        other.body as { matches: { previousOrders: unknown[] }[] }
      ).matches[0];
      expect(otherMatch.previousOrders).toEqual([]);
      expect(JSON.stringify(other.body)).not.toContain(order.internal);
    });

    it('finds the customer of an order number, shows that order, and never opens it for another owner', async () => {
      const res = await lookup('unified', orderNumber.internal);
      expect(res.status).toBe(200);
      const body = res.body as {
        matches: {
          reference: { number: string } | null;
          openable: unknown;
          notAssignedToYou: boolean;
          partialName: string;
        }[];
      };
      expect(body.matches).toHaveLength(1);
      expect(body.matches[0].reference?.number).toBe(orderNumber.internal);
      expect(body.matches[0].openable).toBeNull();
      expect(body.matches[0].notAssignedToYou).toBe(true);

      const owner = await lookup('owner', orderNumber.internal);
      expect(
        (owner.body as { matches: { openable: unknown }[] }).matches[0]
          .openable,
      ).toEqual({ type: 'ORDER', id: order.internal });
    });

    it('an agent order number is not discoverable', async () => {
      const res = await lookup('unified', orderNumber.agentOnly);
      expect(res.status).toBe(200);
      expect((res.body as { matches: unknown[] }).matches).toHaveLength(0);
    });
  });

  describe('agent data is invisible to internal callers', () => {
    it('a customer whose footprint is only an agent’s is not found', async () => {
      const res = await lookup('searcher', phones.agentOnly.national);
      expect(res.status).toBe(200);
      expect((res.body as { exists: boolean }).exists).toBe(false);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(orderNumber.agentOnly);
    });

    it('a customer served by both shows only the company order, never the agent’s', async () => {
      const res = await lookup('searcher', phones.mixed.national);
      const matches = (
        res.body as { matches: { reference: { number: string } }[] }
      ).matches;
      expect(matches).toHaveLength(1);
      expect(matches[0].reference.number).toBe(orderNumber.mixedInternal);
      expect(JSON.stringify(res.body)).not.toContain(orderNumber.mixedAgent);
      // The agent's order is neither the latest order nor counted.
      const disclosure = (
        res.body as {
          matches: {
            disclosure: {
              latestOrder: { number: string };
              placedOrders: number;
            };
          }[];
        }
      ).matches[0].disclosure;
      expect(disclosure.latestOrder.number).toBe(orderNumber.mixedInternal);
      expect(disclosure.placedOrders).toBe(1);
    });
  });

  describe('query quality, audit and rate limit', () => {
    it('rejects too-short queries (phone < 7 digits, name < 3 letters) and audits the rejection', async () => {
      for (const query of ['12345', 'ab', '   ', '']) {
        const res = await lookup('searcher', query);
        expect([400]).toContain(res.status);
      }
      const rejected = await prisma.globalLookupAudit.count({
        where: {
          userId: ids.searcher,
          action: 'ADVANCED_CUSTOMER_LOOKUP',
          outcome: 'REJECTED',
        },
      });
      expect(rejected).toBeGreaterThanOrEqual(3);
    });

    it('audits hits AND misses (action, method, outcome, result count)', async () => {
      const miss = await lookup('searcher', phones.missing.national);
      expect(miss.status).toBe(200);
      expect(
        (miss.body as { exists: boolean; matches: unknown[] }).exists,
      ).toBe(false);
      const rows = await prisma.globalLookupAudit.findMany({
        where: {
          userId: ids.searcher,
          action: 'ADVANCED_CUSTOMER_LOOKUP',
          outcome: { in: ['MATCH', 'NO_MATCH'] },
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.some((row) => row.outcome === 'NO_MATCH')).toBe(true);
      expect(rows.some((row) => row.outcome === 'MATCH')).toBe(true);
      const missRow = rows.find((row) => row.outcome === 'NO_MATCH')!;
      expect(missRow.resultCount).toBe(0);
      expect(missRow.outcomeDetail).toBeNull();
      expect(missRow.method).toBe('PHONE');
      const hitRow = rows.find((row) => row.outcome === 'MATCH')!;
      expect(hitRow.resultCount).toBeGreaterThan(0);
    });

    it('throttles a user past the per-window budget (429), audits it, and does not affect others', async () => {
      await prisma.globalLookupAudit.createMany({
        data: Array.from({ length: RATE_LIMIT_MAX_PER_WINDOW }, () => ({
          userId: ids.rateLimited,
          action: 'ADVANCED_CUSTOMER_LOOKUP' as const,
          method: 'PHONE' as const,
          queryValue: '+966500000000',
          outcome: 'NO_MATCH',
          resultCount: 0,
        })),
      });
      const blocked = await lookup('rateLimited', phones.internal.national);
      expect(blocked.status).toBe(429);
      const body = blocked.body as Record<string, unknown>;
      expect(JSON.stringify(body)).toContain('LOOKUP_RATE_LIMITED');
      expect(JSON.stringify(body)).not.toContain(orderNumber.internal);
      const throttled = await prisma.globalLookupAudit.count({
        where: { userId: ids.rateLimited, outcome: 'RATE_LIMITED' },
      });
      expect(throttled).toBe(1);
      // A second blocked call within the minute does not flood the audit.
      await lookup('rateLimited', phones.internal.national);
      expect(
        await prisma.globalLookupAudit.count({
          where: { userId: ids.rateLimited, outcome: 'RATE_LIMITED' },
        }),
      ).toBe(1);

      const other = await lookup('rateLimitedOther', phones.internal.national);
      expect(other.status).toBe(200);
    });
  });

  describe('R7 review fixes', () => {
    it('parallel burst cannot overshoot the per-window budget (atomic reservation)', async () => {
      const burst = await Promise.all(
        Array.from({ length: RATE_LIMIT_MAX_PER_WINDOW + 10 }, () =>
          lookup('burst', phones.missing.national),
        ),
      );
      const ok = burst.filter((r) => r.status === 200).length;
      const limited = burst.filter((r) => r.status === 429).length;
      expect(ok).toBe(RATE_LIMIT_MAX_PER_WINDOW);
      expect(limited).toBe(10);
      // No reservation is left PENDING once the calls settle.
      expect(
        await prisma.globalLookupAudit.count({
          where: { userId: ids.burst, outcome: 'PENDING' },
        }),
      ).toBe(0);
    });

    it('a single word (a sweepable prefix) is refused', async () => {
      const res = await lookup('searcher', 'Sweep');
      expect(res.status).toBe(400);
    });

    it('a broad name matching more than the result cap returns no rows at all', async () => {
      const common = `Sweep${suffix}`;
      for (let i = 0; i < 7; i += 1) {
        const partner = await prisma.partner.create({
          data: {
            name: `${common} Alpha${i}x`,
            partnerNumber: `R7L-SW-${suffix}-${i}`,
            roles: { create: { role: 'CUSTOMER' } },
          },
        });
        partnerIds.push(partner.id);
      }
      const broad = await lookup('searcher', `${common} Alpha`);
      expect(broad.status).toBe(200);
      const body = broad.body as { matches: unknown[]; capped: boolean };
      expect(body.matches).toHaveLength(0);
      expect(body.capped).toBe(true);
      // A specific full name still finds its customer.
      const exact = await lookup('searcher', `${common} Alpha3x`);
      expect((exact.body as { matches: unknown[] }).matches).toHaveLength(1);
    });

    it('a phone owned by a non-customer partner (supplier) is not a discovery hit', async () => {
      const supplierPhone = nationalAndE164();
      const supplier = await prisma.partner.create({
        data: {
          name: `R7 Lookup Supplier ${suffix}`,
          partnerNumber: `R7L-SUP-${suffix}`,
          roles: { create: { role: 'SUPPLIER' } },
        },
      });
      partnerIds.push(supplier.id);
      await prisma.partnerPhoneKey.create({
        data: {
          phoneE164: supplierPhone.e164,
          partnerId: supplier.id,
          kind: 'MOBILE',
        },
      });
      const res = await lookup('searcher', supplierPhone.national);
      expect(res.status).toBe(200);
      expect((res.body as { exists: boolean }).exists).toBe(false);
    });

    it('legacy phone lookup: somebody else’s customer is masked, the caller’s own is full', async () => {
      const other = await request(http)
        .get('/partners/global-lookup')
        .query({ phone: phones.internal.national })
        .set(auth('globalOnly'));
      expect(other.status).toBe(200);
      const masked = other.body as Record<string, unknown>;
      expect(masked.restricted).toBe(true);
      expect(masked.notAssignedToYou).toBe(true);
      for (const forbidden of [
        'id',
        'address',
        'city',
        'recentOrders',
        'lastOrder',
        'name',
        'phone',
        'mobile',
      ]) {
        expect(masked).not.toHaveProperty(forbidden);
      }
      expect(JSON.stringify(masked)).not.toContain(customer.internal);
      expect(JSON.stringify(masked)).not.toContain(phones.internal.e164);

      const mine = await request(http)
        .get('/partners/global-lookup')
        .query({ phone: phones.internal.national })
        .set(auth('owner'));
      expect(mine.status).toBe(200);
      expect((mine.body as { restricted: boolean }).restricted).toBe(false);
      expect((mine.body as { name: string }).name).toBe(customer.internal);
    });

    it('legacy phone lookup never returns an agent-only customer', async () => {
      const res = await request(http)
        .get('/partners/global-lookup')
        .query({ phone: phones.agentOnly.national })
        .set(auth('owner'));
      expect(res.status).toBe(200);
      expect(
        res.body === null || Object.keys(res.body as object).length === 0,
      ).toBe(true);
    });

    it('legacy order-number lookup: masked for another owner’s order, full for the owner', async () => {
      const other = await request(http)
        .get('/store-orders/global-lookup')
        .query({ orderNumber: orderNumber.internal })
        .set(auth('globalOnly'));
      expect(other.status).toBe(200);
      const masked = other.body as Record<string, unknown>;
      expect(masked.restricted).toBe(true);
      expect(masked.orderNumber).toBe(orderNumber.internal);
      for (const forbidden of [
        'id',
        'products',
        'paymentStatus',
        'shippingStage',
        'customerName',
        'customerPhone',
        'orderDate',
      ]) {
        expect(masked).not.toHaveProperty(forbidden);
      }
      const mine = await request(http)
        .get('/store-orders/global-lookup')
        .query({ orderNumber: orderNumber.internal })
        .set(auth('owner'));
      expect((mine.body as { restricted: boolean }).restricted).toBe(false);
    });

    it('legacy lookups draw on the same audited budget as the advanced lookup', async () => {
      const before = await prisma.globalLookupAudit.count({
        where: { userId: ids.globalOnly },
      });
      expect(before).toBeGreaterThanOrEqual(2);
      const rows = await prisma.globalLookupAudit.findMany({
        where: { userId: ids.globalOnly },
      });
      expect(rows.every((row) => row.outcome !== 'PENDING')).toBe(true);
      expect(rows.some((row) => row.action === 'GLOBAL_CUSTOMER_LOOKUP')).toBe(
        true,
      );
      expect(rows.some((row) => row.action === 'GLOBAL_ORDER_LOOKUP')).toBe(
        true,
      );
    });
  });
});
