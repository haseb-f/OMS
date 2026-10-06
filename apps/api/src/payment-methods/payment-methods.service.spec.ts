import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PaymentMethodsModule } from './payment-methods.module';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * Google Sheets Readiness (2026-08-13, spec section 5/6) — every Payment
 * Method must resolve to a real, active, leaf/posting Chart of Accounts
 * row; the account is never auto-created and never a header account. Runs
 * against the real local Postgres, same pattern as every other master-data
 * service spec in this repo.
 */
describe('PaymentMethodsService — account link', () => {
  let moduleRef: TestingModule;
  let service: PaymentMethodsService;
  let prisma: PrismaService;

  let postingAccountId: string;
  let headerAccountId: string;
  const createdPaymentMethodIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        AuthModule,
        PaymentMethodsModule,
      ],
    }).compile();
    await moduleRef.init();

    service = moduleRef.get(PaymentMethodsService);
    prisma = moduleRef.get(PrismaService);

    const suffix = randomUUID().slice(0, 8);
    const header = await prisma.chartOfAccount.create({
      data: {
        code: `PMTEST-HDR-${suffix}`,
        name: `Payment Method Test Header ${suffix}`,
        accountType: 'ASSET',
      },
    });
    headerAccountId = header.id;
    const posting = await prisma.chartOfAccount.create({
      data: {
        code: `PMTEST-LEAF-${suffix}`,
        name: `Payment Method Test Leaf ${suffix}`,
        accountType: 'ASSET',
        parentAccountId: header.id,
      },
    });
    postingAccountId = posting.id;
    // Creating a child flips the parent to a header/non-posting account —
    // the same rule `ChartOfAccountsService.create` applies (Part 13).
    await prisma.chartOfAccount.update({
      where: { id: header.id },
      data: { allowsPosting: false },
    });
  });

  afterAll(async () => {
    await prisma.paymentMethod.deleteMany({
      where: { id: { in: createdPaymentMethodIds } },
    });
    await prisma.chartOfAccount.deleteMany({
      where: { id: { in: [postingAccountId, headerAccountId] } },
    });
    await prisma.$disconnect();
    await moduleRef.close();
  });

  it('creates a Payment Method linked to a real posting account, and the account is returned on findOne', async () => {
    const created = await service.create({
      name: `Cash Flow Test Payment Method ${randomUUID().slice(0, 8)}`,
      accountId: postingAccountId,
    });
    createdPaymentMethodIds.push(created.id);

    const found = await service.findOne(created.id);
    expect((found as { account?: { id: string } }).account?.id).toBe(
      postingAccountId,
    );
  });

  it('rejects a Payment Method whose account does not exist — never auto-creates one', async () => {
    await expect(
      service.create({
        name: `Cash Flow Test Payment Method ${randomUUID().slice(0, 8)}`,
        accountId: randomUUID(),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a header/non-posting account — a Payment Method must resolve to a leaf account', async () => {
    await expect(
      service.create({
        name: `Cash Flow Test Payment Method ${randomUUID().slice(0, 8)}`,
        accountId: headerAccountId,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('lets an existing Payment Method be edited to change its linked account', async () => {
    const suffix = randomUUID().slice(0, 8);
    const otherLeaf = await prisma.chartOfAccount.create({
      data: {
        code: `PMTEST-LEAF2-${suffix}`,
        name: `Payment Method Test Leaf 2 ${suffix}`,
        accountType: 'ASSET',
      },
    });

    const created = await service.create({
      name: `Cash Flow Test Payment Method ${suffix}`,
      accountId: postingAccountId,
    });
    createdPaymentMethodIds.push(created.id);

    const updated = await service.update(created.id, {
      accountId: otherLeaf.id,
    });
    expect((updated as { account?: { id: string } }).account?.id).toBe(
      otherLeaf.id,
    );

    await prisma.chartOfAccount.delete({ where: { id: otherLeaf.id } });
  });

  it('refuses to re-point the account while posted claims await settlement (409 with count); allowed once settled', async () => {
    const suffix = randomUUID().slice(0, 8);
    const otherLeaf = await prisma.chartOfAccount.create({
      data: {
        code: `PMTEST-LEAF3-${suffix}`,
        name: `Payment Method Test Leaf 3 ${suffix}`,
        accountType: 'ASSET',
      },
    });
    const created = await service.create({
      name: `Cash Flow Test Payment Method ${suffix}`,
      accountId: postingAccountId,
    });
    createdPaymentMethodIds.push(created.id);
    const currency = await prisma.currency.findFirstOrThrow({
      where: { deletedAt: null },
    });
    const source = await prisma.paymentSource.findFirstOrThrow({
      where: { deletedAt: null, isActive: true },
    });
    const claim = await prisma.payment.create({
      data: {
        paymentNumber: `PAY-PMTEST-${suffix}`,
        paymentDate: new Date(),
        amount: 10,
        currencyId: currency.id,
        paymentSourceId: source.id,
        paymentMethodId: created.id,
        senderName: 'Payment method test',
        status: 'VERIFIED',
        settlementStatus: 'AWAITING_SETTLEMENT',
      },
    });
    try {
      await expect(
        service.update(created.id, { accountId: otherLeaf.id }),
      ).rejects.toThrow(/1 posted payment awaiting provider settlement/);
      // Same account (no change) and other fields still save.
      await expect(
        service.update(created.id, { accountId: postingAccountId }),
      ).resolves.toBeTruthy();

      await prisma.payment.update({
        where: { id: claim.id },
        data: { settlementStatus: 'SETTLED' },
      });
      const updated = await service.update(created.id, {
        accountId: otherLeaf.id,
      });
      expect((updated as { account?: { id: string } }).account?.id).toBe(
        otherLeaf.id,
      );
    } finally {
      await prisma.paymentActivity.deleteMany({
        where: { paymentId: claim.id },
      });
      await prisma.payment.delete({ where: { id: claim.id } });
      await prisma.paymentMethod.update({
        where: { id: created.id },
        data: { accountId: postingAccountId },
      });
      await prisma.chartOfAccount.delete({ where: { id: otherLeaf.id } });
    }
  });

  it('R13 D1: links an active channel (returned with its fee estimate), refuses an inactive one and clears it with null', async () => {
    const suffix = randomUUID().slice(0, 8);
    const channel = await prisma.paymentSource.create({
      data: { name: `PM Channel ${suffix}`, feePercentage: 2.5 },
    });
    const inactive = await prisma.paymentSource.create({
      data: { name: `PM Channel Off ${suffix}`, isActive: false },
    });
    try {
      const created = await service.create({
        name: `Channel Payment Method ${suffix}`,
        accountId: postingAccountId,
        paymentSourceId: channel.id,
      });
      createdPaymentMethodIds.push(created.id);
      const withChannel = created as {
        paymentSource?: { id: string; feePercentage: unknown } | null;
      };
      expect(withChannel.paymentSource?.id).toBe(channel.id);
      expect(Number(withChannel.paymentSource?.feePercentage)).toBe(2.5);

      await expect(
        service.update(created.id, { paymentSourceId: inactive.id }),
      ).rejects.toThrow(/inactive/);
      await expect(
        service.update(created.id, { paymentSourceId: randomUUID() }),
      ).rejects.toThrow(BadRequestException);

      const cleared = await service.update(created.id, {
        paymentSourceId: null,
      });
      expect(cleared.paymentSourceId).toBeNull();
    } finally {
      await prisma.paymentMethod.updateMany({
        where: { paymentSourceId: { in: [channel.id, inactive.id] } },
        data: { paymentSourceId: null },
      });
      await prisma.paymentSource.deleteMany({
        where: { id: { in: [channel.id, inactive.id] } },
      });
    }
  });

  it('never forces Currency or Country onto a Payment Method — the model has no such fields', async () => {
    const created = await service.create({
      name: `Cash Flow Test Payment Method ${randomUUID().slice(0, 8)}`,
      accountId: postingAccountId,
    });
    createdPaymentMethodIds.push(created.id);
    expect(created).not.toHaveProperty('currencyId');
    expect(created).not.toHaveProperty('countryId');
  });
});
