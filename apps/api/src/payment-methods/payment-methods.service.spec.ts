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
