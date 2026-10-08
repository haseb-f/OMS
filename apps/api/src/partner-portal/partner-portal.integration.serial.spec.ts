/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- supertest response bodies are untyped JSON under assertion */
import 'dotenv/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  type HttpException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  AccountType,
  JournalEntryStatus,
  PartnerAgreementFrequency,
  PartnerProfitBasis,
} from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { UserSessionsService } from '../auth/sessions/user-sessions.service';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';
import { formatValidationErrors } from '../common/errors/format-validation-errors';
import { CompanyPartnersModule } from '../company-partners/company-partners.module';
import { CompanyPartnersService } from '../company-partners/company-partners.service';
import { PartnerProfitService } from '../company-partners/partner-profit.service';
import { PartnerPaymentsService } from '../company-partners/partner-payments.service';
import { UsersService } from '../users/users.service';
import { hashPassword } from '../auth/password.util';
import { PartnerPortalModule } from './partner-portal.module';

/**
 * R15 W4 (spec-w4, D15-14, D15-15) — a company partner's own login and the
 * per-period statement over the real HTTP pipeline (real guards, real JWTs,
 * local Postgres). The ledger is seeded in 2019: no journal entry, profit
 * period or agreement exists there (checked first), and the real clock is
 * past every fixture period, so periods close and the partnership has
 * ENDED without faking time.
 *
 * Partner P: net basis 30 %, 2019-01-01 → 2019-04-15 (monthly).
 * Partner Q: gross basis 20 %, 2019-01-01 → 2019-05-31 — never visible to P.
 * Ledger (revenue / cost of sales / expenses → net): Jan 10 000 / 4 000 /
 * 1 000 → 5 000; Feb 20 000 / 8 000 / 2 000 → 10 000; Mar 30 000 / 12 000 /
 * 3 000 → 15 000; Apr 40 000 + cost 16 000 on the 10th, expense 4 000 on the
 * 20th → 1–15 net 24 000. P: Jan 1 500, Feb 3 000, Mar 4 500, Apr(1–15) 7 200.
 * January closes, gets a late invoice (+1 000 → P +300), February closes,
 * March is reviewed only, April stays open. P is paid 2 000 (5 March) and
 * 1 000 (10 June, after the partnership ended).
 */
describe('R15 W4 — partner login, portal and per-period statement (HTTP integration)', () => {
  jest.setTimeout(300_000);
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const lower = tag.toLowerCase();
  let seq = 0;

  let moduleRef: TestingModule;
  let app: INestApplication;
  let http: Server;
  let prisma: PrismaService;
  let sessions: UserSessionsService;
  let partners: CompanyPartnersService;
  let profit: PartnerProfitService;
  let payments: PartnerPaymentsService;
  let users: UsersService;

  const created = {
    partners: [] as string[],
    users: [] as string[],
    accounts: [] as string[],
    entries: [] as string[],
  };
  let acc: {
    revenue: string;
    cogs: string;
    inventory: string;
    ar: string;
    expense: string;
    bank: string;
    other: string;
    otherCode: string;
  };
  let pId: string;
  let qId: string;
  let pProfileId: string;
  let qName: string;
  let janId: string;
  let mayId: string;
  const tokens = {} as Record<'manager' | 'viewer' | 'admin', string>;
  let partnerUserId: string;
  let partnerEmail: string;
  let partnerToken: string;
  const partnerPassword = `Partner-${tag}-2019!`;

  const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
  const get = (token: string, path: string) =>
    request(http).get(path).set('Authorization', `Bearer ${token}`);
  const post = (token: string, path: string, body: object = {}) =>
    request(http).post(path).set('Authorization', `Bearer ${token}`).send(body);

  async function fixture(
    date: string,
    sourceType: string,
    lines: Array<[string, number, number]>,
  ) {
    const total = lines.reduce((s, [, debit]) => s + debit, 0);
    const entry = await prisma.journalEntry.create({
      data: {
        entryNumber: `T-PP-${tag}-${++seq}`,
        entryDate: d(date),
        status: JournalEntryStatus.POSTED,
        sourceType,
        sourceId: randomUUID(),
        description: `Partner portal fixture ${tag}`,
        totalDebit: total,
        totalCredit: total,
        postedAt: new Date(),
        lines: {
          create: lines.map(([accountId, debit, credit], i) => ({
            accountId,
            debit,
            credit,
            lineOrder: i,
          })),
        },
      },
    });
    created.entries.push(entry.id);
  }

  /** Revenue, cost of sales and expenses of one month (or part of it). */
  async function month(
    date: string,
    revenue: number,
    cost: number,
    expense: number,
    expenseDate = date,
  ) {
    await fixture(date, 'SALES_INVOICE', [
      [acc.ar, revenue, 0],
      [acc.revenue, 0, revenue],
      [acc.cogs, cost, 0],
      [acc.inventory, 0, cost],
    ]);
    await fixture(expenseDate, 'EXPENSE_PAYMENT', [
      [acc.expense, expense, 0],
      [acc.bank, 0, expense],
    ]);
  }

  async function internalUser(
    label: string,
    permissionNames: string[],
    isSuperAdmin = false,
  ) {
    const user = await prisma.user.create({
      data: {
        email: `${label}-${lower}@partners.test`,
        username: `${label}-${lower}`,
        fullName: `${label} ${tag}`,
        passwordHash: await hashPassword(`Internal-${tag}-x`),
        isSuperAdmin,
      },
    });
    created.users.push(user.id);
    if (permissionNames.length) {
      await users.setPermissions(user.id, { permissionNames });
    }
    return sessions.issueAccessToken({ sub: user.id, email: user.email });
  }

  async function login(email: string, password: string) {
    return request(http).post('/auth/login').send({ email, password });
  }

  /** Every key and string value of a JSON body, for leak checks. */
  function flatten(value: unknown, keys: Set<string>, strings: Set<string>) {
    if (Array.isArray(value)) {
      for (const item of value) flatten(item, keys, strings);
    } else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        keys.add(key);
        flatten(inner, keys, strings);
      }
    } else if (typeof value === 'string') {
      strings.add(value);
    }
  }

  function expectPartnerSafe(body: unknown) {
    const keys = new Set<string>();
    const strings = new Set<string>();
    flatten(body, keys, strings);
    for (const forbidden of [
      'journalEntryId',
      'reversalJournalEntryId',
      'financialAccount',
      'financialAccountId',
      'accountId',
      'notes',
      'reversalReason',
      'partnerName',
      'snapshot',
      'createdBy',
      'agreementId',
      'customerId',
    ]) {
      expect([forbidden, keys.has(forbidden)]).toEqual([forbidden, false]);
    }
    for (const value of [qName, qId, acc.otherCode, `${acc.otherCode} name`]) {
      expect([value, strings.has(value)]).toEqual([value, false]);
    }
    expect(JSON.stringify(body)).not.toContain(qName);
  }

  async function expectError(
    promise: Promise<unknown>,
    code: string,
  ): Promise<void> {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(
      ((error as HttpException).getResponse() as { code?: string }).code,
    ).toBe(code);
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        CompanyPartnersModule,
        PartnerPortalModule,
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
    sessions = moduleRef.get(UserSessionsService, { strict: false });
    partners = moduleRef.get(CompanyPartnersService, { strict: false });
    profit = moduleRef.get(PartnerProfitService, { strict: false });
    payments = moduleRef.get(PartnerPaymentsService, { strict: false });
    users = moduleRef.get(UsersService, { strict: false });

    // Preconditions: 2019 is an empty ledger and an empty profit pool here.
    const year = { gte: d('2019-01-01'), lte: d('2019-12-31') };
    expect(
      await prisma.journalEntry.count({ where: { entryDate: year } }),
    ).toBe(0);
    expect(
      await prisma.partnerProfitPeriod.count({ where: { periodFrom: year } }),
    ).toBe(0);
    expect(
      await prisma.partnerAgreement.count({
        where: {
          status: { in: ['ACTIVE', 'ENDED'] },
          effectiveFrom: { lte: d('2019-12-31') },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: d('2019-01-01') } },
          ],
        },
      }),
    ).toBe(0);

    const settings = await prisma.postingSettings.findFirstOrThrow();
    const other = await prisma.chartOfAccount.create({
      data: {
        code: `TPPOTH-${tag}`,
        name: `TPPOTH-${tag} name`,
        accountType: AccountType.ASSET,
      },
    });
    created.accounts.push(other.id);
    acc = {
      revenue: settings.salesRevenueAccountId!,
      cogs: settings.costOfGoodsSoldAccountId!,
      inventory: settings.inventoryAccountId!,
      ar: settings.accountsReceivableAccountId!,
      expense: settings.defaultExpenseAccountId!,
      bank: settings.bankAccountId!,
      other: other.id,
      otherCode: other.code,
    };

    await month('2019-01-10', 10_000, 4_000, 1_000);
    await month('2019-02-10', 20_000, 8_000, 2_000);
    await month('2019-03-10', 30_000, 12_000, 3_000);
    await month('2019-04-10', 40_000, 16_000, 4_000, '2019-04-20');

    const p = await partners.create({ name: `Portal P ${tag}` });
    const q = await partners.create({ name: `Portal Q ${tag}` });
    pId = p.partnerId;
    pProfileId = p.id;
    qId = q.partnerId;
    qName = q.name;
    created.partners.push(pId, qId);

    tokens.manager = await internalUser('mgr', [
      'company-partners.view',
      'company-partners.users.manage',
    ]);
    tokens.viewer = await internalUser('viewer', ['company-partners.view']);
    tokens.admin = await internalUser('admin', [], true);
  });

  afterAll(async () => {
    if (prisma) {
      const partnerIds = created.partners;
      const periods = await prisma.partnerProfitPeriod.findMany({
        where: { entitlements: { some: { partnerId: { in: partnerIds } } } },
        select: { id: true },
      });
      const periodIds = periods.map((p) => p.id);
      const adjustments = await prisma.partnerProfitAdjustment.findMany({
        where: { periodId: { in: periodIds } },
        select: { id: true },
      });
      const paymentRows = await prisma.partnerPayment.findMany({
        where: { partnerId: { in: partnerIds } },
        select: { id: true },
      });
      const posted = await prisma.journalEntry.findMany({
        where: {
          sourceId: {
            in: [
              ...periodIds,
              ...adjustments.map((a) => a.id),
              ...paymentRows.map((p) => p.id),
            ],
          },
        },
        select: { id: true },
      });
      const entryIds = [...posted.map((e) => e.id), ...created.entries];
      await prisma.partnerEntitlement.deleteMany({
        where: { periodId: { in: periodIds } },
      });
      await prisma.partnerProfitAdjustment.deleteMany({
        where: { periodId: { in: periodIds } },
      });
      await prisma.partnerProfitPeriod.deleteMany({
        where: { id: { in: periodIds } },
      });
      await prisma.partnerPayment.deleteMany({
        where: { partnerId: { in: partnerIds } },
      });
      await prisma.partnerAgreement.deleteMany({
        where: { partnerId: { in: partnerIds } },
      });
      const partnerUsers = await prisma.user.findMany({
        where: {
          OR: [
            { companyPartner: { partnerId: { in: partnerIds } } },
            { email: { endsWith: `-${lower}@partners.test` } },
          ],
        },
        select: { id: true },
      });
      const userIds = [
        ...new Set([...created.users, ...partnerUsers.map((u) => u.id)]),
      ];
      await prisma.userPermission.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.companyPartnerProfile.deleteMany({
        where: { partnerId: { in: partnerIds } },
      });
      await prisma.journalEntryActivity.deleteMany({
        where: { journalEntryId: { in: entryIds } },
      });
      await prisma.journalEntryLine.deleteMany({
        where: { journalEntryId: { in: entryIds } },
      });
      await prisma.journalEntry.updateMany({
        where: { id: { in: entryIds } },
        data: { reversalOfEntryId: null },
      });
      await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
      await prisma.chartOfAccount.deleteMany({
        where: { id: { in: created.accounts } },
      });
      await prisma.masterDataActivityLog.deleteMany({
        where: { entityId: { in: [...partnerIds, ...userIds] } },
      });
      await prisma.partnerPhoneKey.deleteMany({
        where: { partnerId: { in: partnerIds } },
      });
      await prisma.partnerRoleAssignment.deleteMany({
        where: { partnerId: { in: partnerIds } },
      });
      await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
    }
    await app?.close();
  });

  it('a login is refused before any agreement is in force, and needs company-partners.users.manage', async () => {
    partnerEmail = `p-${lower}@partners.test`;
    const early = await post(
      tokens.manager,
      `/company-partners/profiles/${pId}/login`,
      { email: partnerEmail, fullName: `Portal P ${tag}` },
    );
    expect([early.status, early.body.code]).toEqual([
      409,
      'PARTNER_LOGIN_NEEDS_AGREEMENT',
    ]);

    await partners.createAgreement({
      partnerId: pId,
      profitSharePercent: 30,
      basis: PartnerProfitBasis.NET_PROFIT,
      effectiveFrom: '2019-01-01',
      effectiveTo: '2019-04-15',
      frequency: PartnerAgreementFrequency.MONTHLY,
    });
    await partners.createAgreement({
      partnerId: qId,
      profitSharePercent: 20,
      basis: PartnerProfitBasis.GROSS_PROFIT,
      effectiveFrom: '2019-01-01',
      effectiveTo: '2019-05-31',
      frequency: PartnerAgreementFrequency.MONTHLY,
    });

    const viewer = await post(
      tokens.viewer,
      `/company-partners/profiles/${pId}/login`,
      { email: partnerEmail, fullName: `Portal P ${tag}` },
    );
    expect(viewer.status).toBe(403);
  });

  it('creates the login: PARTNER user, temporary password, partner.* only; one login per partner', async () => {
    const res = await post(
      tokens.manager,
      `/company-partners/profiles/${pId}/login`,
      { email: partnerEmail.toUpperCase(), fullName: `Portal P ${tag}` },
    );
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toEqual(expect.any(String));
    expect(res.body.login).toMatchObject({
      email: partnerEmail,
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: null,
    });
    partnerUserId = res.body.login.userId;
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: partnerUserId },
      include: { userPermissions: { include: { permission: true } } },
    });
    expect([row.userType, row.companyPartnerId, row.isSuperAdmin]).toEqual([
      'PARTNER',
      pProfileId,
      false,
    ]);
    expect(row.userPermissions.map((p) => p.permission.name).sort()).toEqual([
      'partner.dashboard.view',
      'partner.statement.view',
    ]);

    const again = await post(
      tokens.manager,
      `/company-partners/profiles/${pId}/login`,
      { email: `p2-${lower}@partners.test`, fullName: 'Second' },
    );
    expect([again.status, again.body.code]).toEqual([
      409,
      'PARTNER_LOGIN_EXISTS',
    ]);

    // The partner page shows the login.
    const page = await get(tokens.viewer, `/company-partners/profiles/${pId}`);
    expect(page.body.login).toMatchObject({ email: partnerEmail });
    expect(page.body.partnership).toEqual({
      status: 'ENDED',
      startedOn: '2019-01-01',
      endsOn: '2019-04-15',
    });

    // First sign-in: typ partner, the temporary password must be changed first.
    const signIn = await login(
      partnerEmail,
      res.body.temporaryPassword as string,
    );
    expect(signIn.status).toBe(200);
    expect(signIn.body.user.userType).toBe('PARTNER');
    partnerToken = signIn.body.accessToken;
    const claims = new JwtService().decode<Record<string, unknown>>(
      partnerToken,
    );
    expect(claims).toMatchObject({
      sub: partnerUserId,
      typ: 'partner',
      companyPartnerId: pProfileId,
    });
    expect(claims.agentId).toBeUndefined();
    const blocked = await get(partnerToken, '/partner-portal/me');
    expect([blocked.status, blocked.body.code]).toEqual([
      403,
      'MUST_CHANGE_PASSWORD',
    ]);
    const me = await get(partnerToken, '/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      userType: 'PARTNER',
      mustChangePassword: true,
      isSuperAdmin: false,
      companyPartner: { partnerId: pId, name: `Portal P ${tag}` },
      agent: null,
    });
    expect([...me.body.permissions].sort()).toEqual([
      'partner.dashboard.view',
      'partner.statement.view',
    ]);
    const changed = await post(partnerToken, '/auth/change-password', {
      currentPassword: res.body.temporaryPassword,
      newPassword: partnerPassword,
    });
    expect(changed.status).toBe(200);
    expect((await get(partnerToken, '/partner-portal/me')).status).toBe(200);
  });

  it('permission audiences: a partner login holds only partner.*, an internal user never partner.*', async () => {
    await expectError(
      users.setPermissions(partnerUserId, {
        permissionNames: ['partner.statement.view', 'company-partners.view'],
      }),
      'PARTNER_USER_PERMISSION',
    );
    await expectError(
      users.setPermissions(partnerUserId, {
        permissionNames: ['agent.dashboard.view'],
      }),
      'PARTNER_USER_PERMISSION',
    );
    const internal = created.users[1];
    await expectError(
      users.setPermissions(internal, {
        permissionNames: ['company-partners.view', 'partner.dashboard.view'],
      }),
      'INTERNAL_USER_PARTNER_PERMISSION',
    );
    // The internal Users API never administers a partner login.
    const lock = await post(tokens.admin, `/users/${partnerUserId}/lock`);
    expect([lock.status, lock.body.code]).toEqual([
      409,
      'PARTNER_USER_MANAGED_IN_PARTNERS',
    ]);
  });

  it('isolation: a partner token is refused on every internal endpoint, an internal token on the portal', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    for (const [method, path] of [
      ['get', '/company-partners/profiles'],
      ['get', `/company-partners/profiles/${pId}`],
      ['get', `/company-partners/profiles/${qId}/statement`],
      ['get', '/company-partners/periods'],
      ['get', '/company-partners/payments'],
      ['get', '/company-partners/logins/candidates'],
      ['post', `/company-partners/profiles/${pId}/login/reset-password`],
      ['get', '/users'],
      ['post', `/users/${fakeId}/lock`],
    ] as const) {
      const res =
        method === 'get'
          ? await get(partnerToken, path)
          : await post(partnerToken, path);
      expect([path, res.status, res.body.code]).toEqual([
        path,
        403,
        'PARTNER_ACCESS_DENIED',
      ]);
    }
    for (const path of [
      '/partner-portal/me',
      '/partner-portal/summary',
      '/partner-portal/statement',
      '/partner-portal/periods',
    ]) {
      const res = await get(tokens.admin, path);
      expect([path, res.status, res.body.code]).toEqual([
        path,
        403,
        'PARTNER_ACCESS_DENIED',
      ]);
    }
  });

  it('periods: January and February close, January is adjusted, March is reviewed, May belongs to Q only', async () => {
    const jan = await profit.saveReview('2019-01-01', '2019-01-31');
    janId = jan.id;
    await profit.close(janId);
    await fixture('2019-01-25', 'SALES_INVOICE', [
      [acc.ar, 1_000, 0],
      [acc.revenue, 0, 1_000],
    ]);
    await profit.adjust(janId, 'Late January invoice');
    const feb = await profit.saveReview('2019-02-01', '2019-02-28');
    await profit.close(feb.id);
    await profit.saveReview('2019-03-01', '2019-03-31');
    const may = await profit.saveReview('2019-05-01', '2019-05-31');
    mayId = may.id;
    expect(may.entitlements.map((e) => e.partnerId)).toEqual([qId]);

    await payments.create({
      partnerId: pId,
      amount: 2_000,
      date: '2019-03-05',
      financialAccountId: acc.bank,
      reference: `TRF-${tag}`,
      notes: `internal note ${tag}`,
    });
    // After the partnership ended the company still pays what it owes.
    await payments.create({
      partnerId: pId,
      amount: 1_000,
      date: '2019-06-10',
      financialAccountId: acc.other,
    });
  });

  it('portal statement (ended partnership, default range): closed / under review / open rows, paid oldest-first, adjustment history', async () => {
    const res = await get(partnerToken, '/partner-portal/statement');
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.range).toEqual({ from: '2019-01-01', to: '2019-04-15' });
    expect(body.partnership.status).toBe('ENDED');
    expect(
      body.periods.map((row: Record<string, unknown>) => [
        row.periodFrom,
        row.status,
        row.entitlement,
        row.adjustments,
        row.approvedDue,
        row.paid,
        row.remaining,
      ]),
    ).toEqual([
      ['2019-01-01', 'CLOSED', 1_500, 300, 1_800, 1_800, 0],
      ['2019-02-01', 'CLOSED', 3_000, 0, 3_000, 1_200, 1_800],
      ['2019-03-01', 'UNDER_REVIEW', 4_500, null, null, null, null],
      // Open estimate only for the days in force (1–15 April), not after the end.
      ['2019-04-01', 'OPEN', 7_200, null, null, null, null],
    ]);
    const april = body.periods[3];
    expect(april.segments).toEqual([
      expect.objectContaining({
        from: '2019-04-01',
        to: '2019-04-15',
        percent: 30,
        basis: 'NET_PROFIT',
        profitBase: {
          netRevenue: 40_000,
          costOfSales: 16_000,
          otherExpensesNet: 0,
          profit: 24_000,
        },
        amount: 7_200,
      }),
    ]);
    expect(body.totals).toEqual({
      estimated: 11_700,
      approvedDue: 4_800,
      paid: 3_000,
      remaining: 1_800,
    });
    expect(body.adjustments).toEqual([
      expect.objectContaining({
        periodFrom: '2019-01-01',
        reason: 'Late January invoice',
        amount: 300,
      }),
    ]);
    expect(body.payments).toEqual([
      {
        paymentNumber: expect.any(String),
        date: '2019-03-05',
        amount: 2_000,
        method: expect.stringMatching(/^(CASH|BANK)$/),
        reference: `TRF-${tag}`,
        reversed: false,
        reversedOn: null,
      },
    ]);
    expect(body.position).toEqual({
      approved: 4_800,
      paid: 3_000,
      payable: 1_800,
      advance: 0,
    });
    expect(body.terms).toEqual([
      {
        profitSharePercent: 30,
        basis: 'NET_PROFIT',
        frequency: 'MONTHLY',
        status: 'ACTIVE',
        effectiveFrom: '2019-01-01',
        effectiveTo: '2019-04-15',
      },
    ]);
    expectPartnerSafe(body);
  });

  it('a period only partly inside the range is included; nothing after the end; same rows as the internal statement', async () => {
    const query = '?from=2019-02-10&to=2019-06-30';
    const portal = await get(partnerToken, `/partner-portal/statement${query}`);
    expect(
      portal.body.periods.map((row: Record<string, unknown>) => [
        row.periodFrom,
        row.status,
      ]),
    ).toEqual([
      ['2019-02-01', 'CLOSED'],
      ['2019-03-01', 'UNDER_REVIEW'],
      ['2019-04-01', 'OPEN'],
    ]);
    expect(portal.body.adjustments).toEqual([]);
    expect(
      portal.body.payments.map((p: Record<string, unknown>) => [
        p.date,
        p.method,
      ]),
    ).toEqual([
      ['2019-06-10', 'OTHER'],
      ['2019-03-05', expect.stringMatching(/^(CASH|BANK)$/)],
    ]);
    expectPartnerSafe(portal.body);

    const internal = await get(
      tokens.viewer,
      `/company-partners/profiles/${pId}/statement${query}`,
    );
    expect(internal.status).toBe(200);
    expect(internal.body.periods).toEqual(portal.body.periods);
    expect(internal.body.totals).toEqual(portal.body.totals);
    // Staff see the payment's account; the partner never does.
    expect(internal.body.payments[0].financialAccount.code).toBe(acc.otherCode);
  });

  it('me / summary / periods / period detail are self-scoped and partner-safe', async () => {
    const me = await get(partnerToken, '/partner-portal/me');
    expect(me.body).toEqual({
      partner: { name: `Portal P ${tag}`, partnerNumber: expect.any(String) },
      partnership: {
        status: 'ENDED',
        startedOn: '2019-01-01',
        endsOn: '2019-04-15',
      },
      currentAgreement: expect.objectContaining({
        profitSharePercent: 30,
        basis: 'NET_PROFIT',
        frequency: 'MONTHLY',
      }),
      agreements: [expect.objectContaining({ profitSharePercent: 30 })],
      login: {
        email: partnerEmail,
        fullName: `Portal P ${tag}`,
        lastLoginAt: expect.any(String),
      },
    });
    expectPartnerSafe(me.body);

    const summary = await get(partnerToken, '/partner-portal/summary');
    expect(summary.body).toMatchObject({
      partnership: { status: 'ENDED' },
      currentPeriod: { periodFrom: '2019-04-01', status: 'OPEN' },
      estimated: 11_700,
      position: { approved: 4_800, paid: 3_000, payable: 1_800 },
      lastPayment: { date: '2019-06-10', amount: 1_000, method: 'OTHER' },
    });
    expectPartnerSafe(summary.body);

    const periods = await get(partnerToken, '/partner-portal/periods');
    expect(
      periods.body.map((row: Record<string, unknown>) => [
        row.periodFrom,
        row.status,
      ]),
    ).toEqual([
      ['2019-03-01', 'UNDER_REVIEW'],
      ['2019-02-01', 'CLOSED'],
      ['2019-01-01', 'CLOSED'],
    ]);
    expectPartnerSafe(periods.body);

    const jan = await get(partnerToken, `/partner-portal/periods/${janId}`);
    expect(jan.body).toMatchObject({
      periodId: janId,
      status: 'CLOSED',
      approvedDue: 1_800,
      adjustmentHistory: [
        expect.objectContaining({
          reason: 'Late January invoice',
          amount: 300,
        }),
      ],
    });
    // Only P's own segment of the pool period.
    expect(jan.body.segments).toHaveLength(1);
    expect(jan.body.segments[0].percent).toBe(30);
    expectPartnerSafe(jan.body);

    // A period in which only another partner has a share is not reachable.
    const may = await get(partnerToken, `/partner-portal/periods/${mayId}`);
    expect(may.status).toBe(404);
  });

  it('disable → the live token gets 401 and sign-in is refused; enable restores; reset ends every session', async () => {
    const disabled = await post(
      tokens.manager,
      `/company-partners/profiles/${pId}/login/disable`,
    );
    expect([disabled.status, disabled.body.isActive]).toEqual([200, false]);
    const refused = await get(partnerToken, '/partner-portal/statement');
    expect(refused.status).toBe(401);
    const signIn = await login(partnerEmail, partnerPassword);
    expect([signIn.status, signIn.body.code]).toEqual([
      403,
      'ACCOUNT_DISABLED',
    ]);

    await post(
      tokens.manager,
      `/company-partners/profiles/${pId}/login/enable`,
    );
    const back = await login(partnerEmail, partnerPassword);
    expect(back.status).toBe(200);
    const token = back.body.accessToken as string;
    expect((await get(token, '/partner-portal/summary')).status).toBe(200);

    const reset = await post(
      tokens.manager,
      `/company-partners/profiles/${pId}/login/reset-password`,
    );
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword).toEqual(expect.any(String));
    expect(reset.body.login.mustChangePassword).toBe(true);
    expect((await get(token, '/partner-portal/summary')).status).toBe(401);
    partnerToken = (
      await login(partnerEmail, reset.body.temporaryPassword as string)
    ).body.accessToken;
    const changed = await post(partnerToken, '/auth/change-password', {
      currentPassword: reset.body.temporaryPassword,
      newPassword: partnerPassword,
    });
    expect(changed.status).toBe(200);
  });

  it('unlink → the login can no longer sign in; it can be linked again', async () => {
    const unlinked = await post(
      tokens.manager,
      `/company-partners/profiles/${pId}/login/unlink`,
    );
    expect(unlinked.status).toBe(200);
    expect((await get(partnerToken, '/auth/me')).status).toBe(401);
    const unlinkedSignIn = await login(partnerEmail, partnerPassword);
    expect([unlinkedSignIn.status, unlinkedSignIn.body.code]).toEqual([
      403,
      'PARTNER_LOGIN_UNLINKED',
    ]);

    const candidates = await get(
      tokens.manager,
      `/company-partners/logins/candidates?search=${encodeURIComponent(partnerEmail)}`,
    );
    expect(candidates.body.map((c: { id: string }) => c.id)).toEqual([
      partnerUserId,
    ]);
    const linked = await post(
      tokens.manager,
      `/company-partners/profiles/${pId}/login/link`,
      { userId: partnerUserId },
    );
    expect([linked.status, linked.body.email]).toEqual([200, partnerEmail]);
    // An internal user is never linkable as a partner login.
    await post(
      tokens.manager,
      `/company-partners/profiles/${pId}/login/unlink`,
    );
    const internal = await post(
      tokens.manager,
      `/company-partners/profiles/${pId}/login/link`,
      { userId: created.users[0] },
    );
    expect([internal.status, internal.body.code]).toEqual([
      409,
      'PARTNER_LOGIN_NOT_LINKABLE',
    ]);
  });
});
