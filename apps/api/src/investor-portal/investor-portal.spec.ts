import { Test, type TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, createHash } from 'crypto';
import { AccountType, InvestorPortalAccountStatus } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { ObjectStorageModule } from '../common/storage/object-storage.module';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { SalesScopeModule } from '../sales-scope/sales-scope.module';
import { InvestmentOpportunitiesModule } from '../investment-opportunities/investment-opportunities.module';
import { InvestorSubscriptionsModule } from '../investor-subscriptions/investor-subscriptions.module';
import { CapitalContributionsModule } from '../capital-contributions/capital-contributions.module';
import { CapitalContributionsService } from '../capital-contributions/capital-contributions.service';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { InvestorLedgerModule } from '../investor-ledger/investor-ledger.module';
import { CapitalReturnsModule } from '../capital-returns/capital-returns.module';
import { CapitalReturnsService } from '../capital-returns/capital-returns.service';
import { InvestmentDistributionsModule } from '../investment-distributions/investment-distributions.module';
import { ProfitDistributionsService } from '../investment-distributions/profit-distributions.service';
import { DistributionPaymentsService } from '../investment-distributions/distribution-payments.service';
import { InvestorPortalModule } from './investor-portal.module';
import { InvestorPortalService } from './investor-portal.service';
import { InvestorPortalAuthService } from './investor-portal-auth.service';
import { InvestorPortalAdminService } from './investor-portal-admin.service';
import { InvestorPortalAuthGuard } from './investor-portal-auth.guard';
import {
  INVESTOR_PORTAL_JWT_SERVICE,
  InvestorPortalJwtPayload,
} from './investor-portal-jwt.provider';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { hashPassword } from '../auth/password.util';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Builds a fake ExecutionContext carrying a bearer token, matching the shape `permissions.guard.spec.ts` already uses for guard unit tests. */
function makeHttpContext(token?: string): ExecutionContext {
  const request: Record<string, unknown> = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/**
 * Investor Engine Milestone 4, Part C-N — reproduces the mission's own
 * Investor A/B acceptance scenario (same numbers Milestone 3's own spec
 * proves: A confirmed capital 65,000 / approved profit 13,000 / paid 13,000
 * / outstanding 0 / capital returned 10,000 / remaining capital 55,000; B
 * confirmed capital 35,000 / approved profit 7,000 / paid 0 / outstanding
 * 7,000) and then exercises the Portal's read surface and — most
 * critically — its cross-Investor isolation (IDOR) and auth-boundary
 * separation from the internal session system.
 */
describe('Investor Portal — dashboard/investments/profits/statement/documents scoping + IDOR', () => {
  jest.setTimeout(180_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let objectStorage: ObjectStorageService;
  let portalService: InvestorPortalService;
  let contributionsService: CapitalContributionsService;
  let distributionsService: ProfitDistributionsService;
  let paymentsService: DistributionPaymentsService;
  let capitalReturnsService: CapitalReturnsService;

  const prefix = `M4-PORTAL-${randomUUID().slice(0, 6)}`;
  let currencyId: string;
  let bankAccountId: string;
  let opportunityId: string;
  let investorAId: string;
  let investorBId: string;
  let subscriptionAId: string;
  let subscriptionBId: string;
  let contributionAId: string;
  let paymentAId: string;
  let attachmentAId: string; // CapitalContribution receipt, belongs to A
  let attachmentBId: string; // DistributionPayment receipt, belongs to B

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        MasterDataModule,
        PermissionsCoreModule,
        AuthModule,
        PhoneModule,
        ObjectStorageModule,
        SalesScopeModule,
        InvestmentOpportunitiesModule,
        InvestorSubscriptionsModule,
        CapitalContributionsModule,
        PostingProvidersModule,
        InvestorLedgerModule,
        InvestmentDistributionsModule,
        CapitalReturnsModule,
        InvestorPortalModule,
      ],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    objectStorage = moduleRef.get(ObjectStorageService);
    portalService = moduleRef.get(InvestorPortalService);
    contributionsService = moduleRef.get(CapitalContributionsService);
    distributionsService = moduleRef.get(ProfitDistributionsService);
    paymentsService = moduleRef.get(DistributionPaymentsService);
    capitalReturnsService = moduleRef.get(CapitalReturnsService);

    const currency = await prisma.currency.upsert({
      where: { code: `${prefix}-CUR` },
      update: {},
      create: { code: `${prefix}-CUR`, name: 'Test Currency' },
    });
    currencyId = currency.id;
    const bankAccount = await prisma.chartOfAccount.create({
      data: {
        code: `${prefix}-BANK`,
        name: 'Portal Test Bank',
        accountType: AccountType.ASSET,
      },
    });
    bankAccountId = bankAccount.id;

    const opportunity = await prisma.investmentOpportunity.create({
      data: {
        code: `${prefix}-OPP`,
        nameAr: `${prefix} Opportunity`,
        currencyId,
        startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        investorNetProfitSharePercent: 40,
        status: 'ACTIVE',
      },
    });
    opportunityId = opportunity.id;

    const investorA = await prisma.investorProfile.create({
      data: {
        partner: {
          create: {
            partnerNumber: `${prefix}-INV-A`,
            name: 'Portal Investor A',
            email: `${prefix}-a@example.test`,
          },
        },
      },
    });
    investorAId = investorA.id;
    const investorB = await prisma.investorProfile.create({
      data: {
        partner: {
          create: {
            partnerNumber: `${prefix}-INV-B`,
            name: 'Portal Investor B',
            email: `${prefix}-b@example.test`,
          },
        },
      },
    });
    investorBId = investorB.id;

    const subscriptionA = await prisma.investorSubscription.create({
      data: {
        investorId: investorAId,
        opportunityId,
        committedAmount: 65000,
        fundedAmount: 0,
        participationPercent: 65,
        status: 'COMMITTED',
      },
    });
    subscriptionAId = subscriptionA.id;
    const subscriptionB = await prisma.investorSubscription.create({
      data: {
        investorId: investorBId,
        opportunityId,
        committedAmount: 35000,
        fundedAmount: 0,
        participationPercent: 35,
        status: 'COMMITTED',
      },
    });
    subscriptionBId = subscriptionB.id;

    const contributionA = await contributionsService.create({
      subscriptionId: subscriptionAId,
      amount: 65000,
      contributionDate: new Date().toISOString(),
      financialAccountId: bankAccountId,
    });
    contributionAId = contributionA.id;
    await contributionsService.confirm(contributionA.id);
    const contributionB = await contributionsService.create({
      subscriptionId: subscriptionBId,
      amount: 35000,
      contributionDate: new Date().toISOString(),
      financialAccountId: bankAccountId,
    });
    await contributionsService.confirm(contributionB.id);

    // Funding receipt document — belongs to Investor A only.
    const storageKeyA = `attachments/test/${prefix}-a-receipt.txt`;
    await objectStorage.put(
      storageKeyA,
      Buffer.from('investor A funding receipt'),
      'text/plain',
    );
    const attachmentA = await prisma.attachment.create({
      data: {
        fileName: `${prefix}-a-receipt.txt`,
        originalName: 'A-funding-receipt.txt',
        mimeType: 'text/plain',
        sizeBytes: 27,
        storageProvider: objectStorage.provider(),
        storageKey: storageKeyA,
        uploadedById: (await prisma.user.findFirstOrThrow()).id,
        finalizedAt: new Date(),
      },
    });
    attachmentAId = attachmentA.id;
    await prisma.capitalContributionAttachment.create({
      data: {
        contributionId: contributionAId,
        attachmentId: attachmentAId,
        uploadedById: attachmentA.uploadedById,
        fileUrl: `storage:${storageKeyA}`,
        fileName: attachmentA.originalName,
        attachmentType: 'CONTRIBUTION_RECEIPT',
      },
    });

    const calculation = await prisma.profitCalculation.create({
      data: {
        opportunityId,
        status: 'APPROVED',
        revenue: 160000,
        cogs: 80000,
        expenses: 20000,
        returnsAdjustment: 10000,
        netProfit: 50000,
        investorSharePercent: 40,
        investorProfitPool: 20000,
        companyProfitPortion: 30000,
        revenueLineCount: 2,
        netUnitsCount: 800,
        expenseLineCount: 1,
        approvedAt: new Date(),
        investorShares: {
          create: [
            {
              investorId: investorAId,
              subscriptionId: subscriptionAId,
              participationPercent: 65,
              profitShareAmount: 13000,
            },
            {
              investorId: investorBId,
              subscriptionId: subscriptionBId,
              participationPercent: 35,
              profitShareAmount: 7000,
            },
          ],
        },
      },
    });

    const distribution = await distributionsService.create({
      profitCalculationId: calculation.id,
    });
    await distributionsService.approve(distribution.id);
    const rowA = distribution.investorDistributions.find(
      (r) => r.investorId === investorAId,
    )!;

    // Investor A fully paid (13,000 -> 0 outstanding).
    const paymentA = await paymentsService.create({
      investorDistributionId: rowA.id,
      amount: 13000,
      paymentDate: new Date().toISOString(),
      financialAccountId: bankAccountId,
    });
    paymentAId = paymentA.id;
    await paymentsService.confirm(paymentA.id);

    // Investor B is deliberately left untouched here — 0 paid / 7,000
    // outstanding is itself part of the mission's exact acceptance numbers
    // (rowB.entitledAmount stays PAYABLE, no DistributionPayment created).

    const capitalReturn = await capitalReturnsService.create({
      subscriptionId: subscriptionAId,
      amount: 10000,
      date: new Date().toISOString(),
      financialAccountId: bankAccountId,
    });
    await capitalReturnsService.approve(capitalReturn.id);
    await capitalReturnsService.pay(capitalReturn.id);

    // Distribution receipt document — belongs to Investor A's own payment.
    const storageKeyB = `attachments/test/${prefix}-a-payment-receipt.txt`;
    await objectStorage.put(
      storageKeyB,
      Buffer.from('investor A payment receipt'),
      'text/plain',
    );
    const attachmentB = await prisma.attachment.create({
      data: {
        fileName: `${prefix}-a-payment-receipt.txt`,
        originalName: 'A-payment-receipt.txt',
        mimeType: 'text/plain',
        sizeBytes: 27,
        storageProvider: objectStorage.provider(),
        storageKey: storageKeyB,
        uploadedById: attachmentA.uploadedById,
        finalizedAt: new Date(),
      },
    });
    attachmentBId = attachmentB.id;
    await prisma.distributionPaymentAttachment.create({
      data: {
        paymentId: paymentAId,
        attachmentId: attachmentBId,
        uploadedById: attachmentA.uploadedById,
        fileUrl: `storage:${storageKeyB}`,
        fileName: attachmentB.originalName,
      },
    });
  });

  afterAll(async () => {
    await prisma.investorPortalActivationToken.deleteMany({
      where: {
        portalAccount: { investorId: { in: [investorAId, investorBId] } },
      },
    });
    await prisma.investorPortalAccount.deleteMany({
      where: { investorId: { in: [investorAId, investorBId] } },
    });
    await prisma.distributionPaymentAttachment.deleteMany({
      where: {
        payment: { investorDistribution: { subscription: { opportunityId } } },
      },
    });
    await prisma.capitalContributionAttachment.deleteMany({
      where: { contribution: { subscription: { opportunityId } } },
    });
    await prisma.attachment.deleteMany({
      where: { id: { in: [attachmentAId, attachmentBId] } },
    });
    await prisma.distributionPayment.deleteMany({
      where: {
        investorDistribution: { profitDistribution: { opportunityId } },
      },
    });
    await prisma.investorDistribution.deleteMany({
      where: { profitDistribution: { opportunityId } },
    });
    await prisma.profitDistribution.deleteMany({ where: { opportunityId } });
    await prisma.capitalReturn.deleteMany({
      where: { subscription: { opportunityId } },
    });
    await prisma.investorLedgerEntry.deleteMany({
      where: { investorId: { in: [investorAId, investorBId] } },
    });
    await prisma.journalEntryActivity.deleteMany({
      where: {
        journalEntry: { lines: { some: { accountId: bankAccountId } } },
      },
    });
    await prisma.journalEntry.deleteMany({
      where: { lines: { some: { accountId: bankAccountId } } },
    });
    await prisma.profitCalculationInvestorShare.deleteMany({
      where: { profitCalculation: { opportunityId } },
    });
    await prisma.profitCalculation.deleteMany({ where: { opportunityId } });
    await prisma.capitalContribution.deleteMany({
      where: { subscription: { opportunityId } },
    });
    await prisma.investorSubscription.deleteMany({ where: { opportunityId } });
    await prisma.investmentOpportunity.delete({ where: { id: opportunityId } });
    await prisma.investorProfile.deleteMany({
      where: { id: { in: [investorAId, investorBId] } },
    });
    await prisma.chartOfAccount.deleteMany({ where: { id: bankAccountId } });
    await prisma.currency.delete({ where: { id: currencyId } });
    await moduleRef.close();
  });

  // ---------------------------------------------------------------------
  // Acceptance-scenario numbers (mission Part Q)
  // ---------------------------------------------------------------------

  it('Investor A dashboard matches the exact acceptance scenario: capital 65,000 / approved 13,000 / paid 13,000 / outstanding 0 / returned 10,000 / remaining 55,000', async () => {
    const dashboard = await portalService.getDashboard(investorAId);
    expect(dashboard.totalConfirmedCapital).toBe(65000);
    expect(dashboard.totalApprovedProfit).toBe(13000);
    expect(dashboard.totalProfitPaid).toBe(13000);
    expect(dashboard.outstandingProfit).toBe(0);
    expect(dashboard.capitalReturned).toBe(10000);
    expect(dashboard.remainingCapitalPosition).toBe(55000);
  });

  it('Investor B dashboard matches the exact acceptance scenario: capital 35,000 / approved 7,000 / paid 0 / outstanding 7,000', async () => {
    const dashboard = await portalService.getDashboard(investorBId);
    expect(dashboard.totalConfirmedCapital).toBe(35000);
    expect(dashboard.totalApprovedProfit).toBe(7000);
    expect(dashboard.totalProfitPaid).toBe(0);
    expect(dashboard.outstandingProfit).toBe(7000);
  });

  // ---------------------------------------------------------------------
  // IDOR — the core security property of this module
  // ---------------------------------------------------------------------

  it("IDOR: investments/:id — B requesting A's subscription id 404s, never leaks A's data", async () => {
    await expect(
      portalService.getInvestmentDetail(investorBId, subscriptionAId),
    ).rejects.toThrow(NotFoundException);
  });

  it("IDOR: investments list never includes the other Investor's subscription", async () => {
    const investmentsA = await portalService.getInvestments(investorAId, {});
    expect(
      investmentsA.items.every((i) => i.subscriptionId !== subscriptionBId),
    ).toBe(true);
    const investmentsB = await portalService.getInvestments(investorBId, {});
    expect(
      investmentsB.items.every((i) => i.subscriptionId !== subscriptionAId),
    ).toBe(true);
  });

  it("IDOR: profits list never includes the other Investor's entitlement", async () => {
    const profitsB = await portalService.getProfits(investorBId, {});
    expect(profitsB.items.every((p) => p.entitledAmount !== 13000)).toBe(true);
  });

  it("IDOR: statement never includes the other Investor's ledger entries", async () => {
    const statementA = await portalService.getStatement(investorAId, {});
    // A's own CAPITAL_FUNDED entry should be present...
    expect(
      statementA.items.some(
        (e) => e.type === 'CAPITAL_FUNDED' && e.creditAmount === 65000,
      ),
    ).toBe(true);
    // ...and B's 35,000 funding must never appear on A's statement.
    expect(
      statementA.items.some(
        (e) => e.type === 'CAPITAL_FUNDED' && e.creditAmount === 35000,
      ),
    ).toBe(false);
  });

  it("IDOR: documents — B cannot list or download A's funding-receipt attachment", async () => {
    const documentsB = await portalService.getDocuments(investorBId, {});
    expect(
      documentsB.items.every((d) => d.attachmentId !== attachmentAId),
    ).toBe(true);

    await expect(
      portalService.getDocumentFile(investorBId, attachmentAId),
    ).rejects.toThrow(NotFoundException);
  });

  it("IDOR: documents — B cannot download A's distribution-payment-receipt attachment", async () => {
    await expect(
      portalService.getDocumentFile(investorBId, attachmentBId),
    ).rejects.toThrow(NotFoundException);
  });

  it("A can download A's own documents", async () => {
    const file = await portalService.getDocumentFile(
      investorAId,
      attachmentAId,
    );
    expect(file.body.toString('utf-8')).toBe('investor A funding receipt');
    expect(file.fileName).toBe('A-funding-receipt.txt');
  });

  it('documents list is investor-scoped and paginated', async () => {
    const documentsA = await portalService.getDocuments(investorAId, {});
    expect(documentsA.items.length).toBe(2); // funding receipt + payment receipt
    expect(
      documentsA.items.every(
        (d) =>
          d.attachmentId === attachmentAId || d.attachmentId === attachmentBId,
      ),
    ).toBe(true);
    expect(documentsA.page).toBe(1);
    expect(documentsA.pageSize).toBe(20);
  });

  it('pagination default is 20/page across investments/profits/statement/documents', async () => {
    expect((await portalService.getInvestments(investorAId, {})).pageSize).toBe(
      20,
    );
    expect((await portalService.getProfits(investorAId, {})).pageSize).toBe(20);
    expect((await portalService.getStatement(investorAId, {})).pageSize).toBe(
      20,
    );
    expect((await portalService.getDocuments(investorAId, {})).pageSize).toBe(
      20,
    );
  });

  it('"me" returns investor-safe profile fields only, with a dynamic Investor Type label (not raw id/code)', async () => {
    const me = await portalService.getMe(investorAId);
    expect(me.name).toBe('Portal Investor A');
    expect(me.email).toBe(`${prefix}-a@example.test`);
    expect((me as Record<string, unknown>).partnerId).toBeUndefined();
    expect((me as Record<string, unknown>).nationalId).toBeDefined(); // present (even if null) as a read-only field
  });

  // ---------------------------------------------------------------------
  // Admin invite / activate / login / suspend / disable lifecycle
  // ---------------------------------------------------------------------

  describe('Admin portal-access lifecycle + auth', () => {
    let adminService: InvestorPortalAdminService;
    let authService: InvestorPortalAuthService;

    beforeAll(() => {
      adminService = moduleRef.get(InvestorPortalAdminService);
      authService = moduleRef.get(InvestorPortalAuthService);
    });

    it('invite creates an INVITED account; status is idempotent to call twice', async () => {
      const first = await adminService.invite(investorAId, {});
      expect(first).toMatchObject({
        hasAccount: true,
        status: InvestorPortalAccountStatus.INVITED,
      });
      const second = await adminService.invite(investorAId, {});
      expect(second).toMatchObject({
        hasAccount: true,
        status: InvestorPortalAccountStatus.INVITED,
      });
    });

    it('activation token from the DB can activate the account and set a password', async () => {
      const account = await prisma.investorPortalAccount.findUniqueOrThrow({
        where: { investorId: investorAId },
      });
      const rawToken = randomUUID() + randomUUID();
      await prisma.investorPortalActivationToken.create({
        data: {
          portalAccountId: account.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      await authService.activate({ token: rawToken, newPassword: 'Passw0rd!' });
      const activated = await prisma.investorPortalAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      expect(activated.status).toBe(InvestorPortalAccountStatus.ACTIVE);
      expect(activated.passwordHash).not.toBeNull();

      // Token is single-use.
      await expect(
        authService.activate({ token: rawToken, newPassword: 'Whatever123' }),
      ).rejects.toThrow();
    });

    it('login succeeds with correct credentials and returns a Portal-scoped JWT', async () => {
      const result = await authService.login({
        email: `${prefix}-a@example.test`,
        password: 'Passw0rd!',
      });
      expect(result.accessToken).toBeTruthy();

      const portalJwt = moduleRef.get<JwtService>(INVESTOR_PORTAL_JWT_SERVICE);
      const payload = portalJwt.verify<InvestorPortalJwtPayload>(
        result.accessToken,
      );
      expect(payload.investorId).toBe(investorAId);
      expect(payload.type).toBe('investor-portal');
    });

    it('login fails with wrong password — same generic error as unknown email (no enumeration)', async () => {
      let wrongPasswordError: unknown;
      let unknownEmailError: unknown;
      try {
        await authService.login({
          email: `${prefix}-a@example.test`,
          password: 'nope',
        });
      } catch (e) {
        wrongPasswordError = e;
      }
      try {
        await authService.login({
          email: 'nobody-at-all@example.test',
          password: 'nope',
        });
      } catch (e) {
        unknownEmailError = e;
      }
      expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException);
      expect(unknownEmailError).toBeInstanceOf(UnauthorizedException);
      expect(
        (wrongPasswordError as UnauthorizedException).getResponse(),
      ).toEqual((unknownEmailError as UnauthorizedException).getResponse());
    });

    it('suspend blocks login even with the correct password; reactivate restores it', async () => {
      await adminService.suspend(investorAId);
      await expect(
        authService.login({
          email: `${prefix}-a@example.test`,
          password: 'Passw0rd!',
        }),
      ).rejects.toThrow(UnauthorizedException);

      await adminService.reactivate(investorAId);
      const result = await authService.login({
        email: `${prefix}-a@example.test`,
        password: 'Passw0rd!',
      });
      expect(result.accessToken).toBeTruthy();
    });

    it('disable blocks login even with the correct password', async () => {
      await adminService.disable(investorAId);
      await expect(
        authService.login({
          email: `${prefix}-a@example.test`,
          password: 'Passw0rd!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ---------------------------------------------------------------------
  // Guard-level: live status re-check + cross-boundary token rejection
  // ---------------------------------------------------------------------

  describe('InvestorPortalAuthGuard — live status + auth-boundary isolation', () => {
    let guard: InvestorPortalAuthGuard;
    let portalJwt: JwtService;
    let internalJwt: JwtService;
    let accountId: string;

    beforeAll(async () => {
      guard = moduleRef.get(InvestorPortalAuthGuard);
      portalJwt = moduleRef.get<JwtService>(INVESTOR_PORTAL_JWT_SERVICE);
      internalJwt = moduleRef.get(JwtService); // the INTERNAL global JwtService (JWT_SECRET)

      const account = await prisma.investorPortalAccount.create({
        data: {
          investorId: investorBId,
          email: `${prefix}-b-guard@example.test`,
          passwordHash: await hashPassword('Passw0rd!'),
          status: InvestorPortalAccountStatus.ACTIVE,
        },
      });
      accountId = account.id;
    });

    afterAll(async () => {
      await prisma.investorPortalAccount.delete({ where: { id: accountId } });
    });

    it('accepts a valid, live-ACTIVE Portal token and sets request.portalInvestor', async () => {
      const token = portalJwt.sign({
        portalAccountId: accountId,
        investorId: investorBId,
        type: 'investor-portal',
      });
      const ctx = makeHttpContext(token);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      const request = ctx.switchToHttp().getRequest<{
        portalInvestor?: InvestorPortalJwtPayload;
      }>();
      expect(request.portalInvestor).toEqual({
        portalAccountId: accountId,
        investorId: investorBId,
        type: 'investor-portal',
      });
    });

    it('CORE SECURITY PROPERTY: rejects an internal session token (signed with JWT_SECRET) even though it is a structurally valid JWT', async () => {
      const internalToken = internalJwt.sign({
        sub: randomUUID(),
        email: 'someone@internal.test',
      });
      const ctx = makeHttpContext(internalToken);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('CORE SECURITY PROPERTY: the internal JwtAuthGuard rejects a Portal token', () => {
      const portalToken = portalJwt.sign({
        portalAccountId: accountId,
        investorId: investorBId,
        type: 'investor-portal',
      });
      const internalGuard = new JwtAuthGuard(internalJwt);
      const ctx = makeHttpContext(portalToken);
      expect(() => internalGuard.canActivate(ctx)).toThrow(
        UnauthorizedException,
      );
    });

    it('mission Part 63: a still-unexpired token for an account SUSPENDED after issuance is rejected on the very next request', async () => {
      const token = portalJwt.sign({
        portalAccountId: accountId,
        investorId: investorBId,
        type: 'investor-portal',
      });
      // Token issued while ACTIVE...
      await expect(guard.canActivate(makeHttpContext(token))).resolves.toBe(
        true,
      );

      // ...account gets suspended after the fact...
      await prisma.investorPortalAccount.update({
        where: { id: accountId },
        data: { status: InvestorPortalAccountStatus.SUSPENDED },
      });

      // ...the SAME still-cryptographically-valid token must now be refused.
      await expect(guard.canActivate(makeHttpContext(token))).rejects.toThrow(
        UnauthorizedException,
      );

      // restore for any later test in this block
      await prisma.investorPortalAccount.update({
        where: { id: accountId },
        data: { status: InvestorPortalAccountStatus.ACTIVE },
      });
    });

    it('rejects a missing bearer token', async () => {
      await expect(
        guard.canActivate(makeHttpContext(undefined)),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
