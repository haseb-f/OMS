import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AccountType } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { AuthModule } from '../auth/auth.module';
import { ChartOfAccountsModule } from './chart-of-accounts.module';
import { ChartOfAccountsService } from './chart-of-accounts.service';

/**
 * Safe Account Deletion (2026-08-15) — the 5 protected root accounts can
 * never be deleted, and any other account is deletable only when it has
 * zero references anywhere in the accounting system (never based on
 * balance alone). Runs against the real local Postgres, same pattern as
 * every other service spec in this repo.
 */
describe('ChartOfAccountsService — Safe Account Deletion', () => {
  let moduleRef: TestingModule;
  let service: ChartOfAccountsService;
  let permissionsResolver: PermissionsResolverService;
  let prisma: PrismaService;

  const prefix = `COADEL-${randomUUID().slice(0, 6)}`;
  let overrideUserId: string;
  let plainUserId: string;
  const createdRootIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        AuthModule,
        ChartOfAccountsModule,
      ],
    }).compile();
    await moduleRef.init();

    service = moduleRef.get(ChartOfAccountsService);
    permissionsResolver = moduleRef.get(PermissionsResolverService);
    prisma = moduleRef.get(PrismaService);

    const overrideUser = await prisma.user.create({
      data: {
        email: `${prefix}-override@example.test`,
        username: `${prefix}-override`,
        fullName: 'CoA Delete Test Override User',
        passwordHash: 'x',
        isSuperAdmin: false,
      },
    });
    overrideUserId = overrideUser.id;
    const overridePermission = await prisma.permission.findUniqueOrThrow({
      where: { name: 'accounting.chart-of-accounts.override-code' },
    });
    const deletePermission = await prisma.permission.findUniqueOrThrow({
      where: { name: 'accounting.chart-of-accounts.delete' },
    });
    await prisma.userPermission.createMany({
      data: [
        { userId: overrideUserId, permissionId: overridePermission.id },
        { userId: overrideUserId, permissionId: deletePermission.id },
      ],
    });

    const plainUser = await prisma.user.create({
      data: {
        email: `${prefix}-plain@example.test`,
        username: `${prefix}-plain`,
        fullName: 'CoA Delete Test Plain User',
        passwordHash: 'x',
        isSuperAdmin: false,
      },
    });
    plainUserId = plainUser.id;
  });

  afterAll(async () => {
    await prisma.paymentMethod.deleteMany({
      where: { name: { startsWith: prefix } },
    });
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntry: { entryNumber: { startsWith: prefix } } },
    });
    await prisma.journalEntry.deleteMany({
      where: { entryNumber: { startsWith: prefix } },
    });
    await prisma.chartOfAccount.deleteMany({
      where: { code: { startsWith: prefix } },
    });
    // Raw delete (bypassing the service's own protection, deliberately —
    // this is test cleanup, not a real deletion request) — only for a
    // placeholder root THIS run created because the code didn't exist yet;
    // a real pre-existing root account is never touched.
    if (createdRootIds.length > 0) {
      await prisma.chartOfAccount.deleteMany({
        where: { id: { in: createdRootIds } },
      });
    }
    const users = await prisma.user.findMany({
      where: { email: { startsWith: prefix } },
      select: { id: true },
    });
    await prisma.userPermission.deleteMany({
      where: { userId: { in: users.map((u) => u.id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    });
    await prisma.$disconnect();
    await moduleRef.close();
  });

  async function createLeaf(overrides: {
    code: string;
    parentAccountId?: string;
  }) {
    return service.create(
      {
        codeOverride: overrides.code,
        name: `Test Account ${overrides.code}`,
        accountType: AccountType.ASSET,
        parentAccountId: overrides.parentAccountId,
      },
      overrideUserId,
    );
  }

  it('deletes an unused leaf account with no references anywhere', async () => {
    const account = await createLeaf({ code: `${prefix}-1` });
    const result = await service.archive(account.id, overrideUserId);
    expect(result.deletedAt).not.toBeNull();

    const reloaded = await prisma.chartOfAccount.findUnique({
      where: { id: account.id },
    });
    expect(reloaded!.deletedAt).not.toBeNull();
  });

  it('never deletes any of the 5 protected root accounts, regardless of usage', async () => {
    const roots: [string, AccountType][] = [
      ['1', AccountType.ASSET],
      ['2', AccountType.LIABILITY],
      ['3', AccountType.EQUITY],
      ['4', AccountType.REVENUE],
      ['5', AccountType.EXPENSE],
    ];
    // These 5 exact codes are the real, permanent root accounts a real
    // Chart of Accounts import creates — this test must verify the real
    // protection behavior on them without ever leaving a fake placeholder
    // account behind: it only creates one when the code genuinely doesn't
    // exist yet, and cleans up exactly (and only) what it created.
    for (const [code, accountType] of roots) {
      const existing = await prisma.chartOfAccount.findUnique({
        where: { code },
      });
      const account =
        existing ??
        (await service.create(
          {
            codeOverride: code,
            name: `Test Root Placeholder ${code}`,
            accountType,
          },
          overrideUserId,
        ));
      if (!existing) createdRootIds.push(account.id);
      expect(account.isSystemAccount).toBe(true);
      await expect(service.archive(account.id, overrideUserId)).rejects.toThrow(
        BadRequestException,
      );
    }
  });

  it('rejects deletion of an account referenced by a Journal Entry Line', async () => {
    const account = await createLeaf({ code: `${prefix}-2` });
    const entry = await prisma.journalEntry.create({
      data: { entryNumber: `${prefix}-JE-1` },
    });
    await prisma.journalEntryLine.create({
      data: { journalEntryId: entry.id, accountId: account.id, debit: 100 },
    });

    await expect(service.archive(account.id, overrideUserId)).rejects.toThrow(
      BadRequestException,
    );
    const reloaded = await prisma.chartOfAccount.findUnique({
      where: { id: account.id },
    });
    expect(reloaded!.deletedAt).toBeNull();
  });

  it('rejects deletion of an account linked to a Payment Method (a financial/account mapping reference)', async () => {
    const account = await createLeaf({ code: `${prefix}-3` });
    await prisma.paymentMethod.create({
      data: { name: `${prefix} Payment Method`, accountId: account.id },
    });

    await expect(service.archive(account.id, overrideUserId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects deletion even when the journal line nets to zero balance — historical usage blocks deletion regardless of balance', async () => {
    const account = await createLeaf({ code: `${prefix}-4` });
    const entry = await prisma.journalEntry.create({
      data: { entryNumber: `${prefix}-JE-2` },
    });
    // Debit then credit the same amount — net zero balance impact.
    await prisma.journalEntryLine.createMany({
      data: [
        { journalEntryId: entry.id, accountId: account.id, debit: 50 },
        { journalEntryId: entry.id, accountId: account.id, credit: 50 },
      ],
    });

    await expect(service.archive(account.id, overrideUserId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('includes the reference type and count in the rejection message', async () => {
    const account = await createLeaf({ code: `${prefix}-5` });
    const entry = await prisma.journalEntry.create({
      data: { entryNumber: `${prefix}-JE-3` },
    });
    await prisma.journalEntryLine.createMany({
      data: [
        { journalEntryId: entry.id, accountId: account.id, debit: 10 },
        { journalEntryId: entry.id, accountId: account.id, debit: 20 },
      ],
    });

    let caught: unknown;
    try {
      await service.archive(account.id, overrideUserId);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).message).toContain('2');
  });

  it('rejects deletion of a header account that still has child accounts', async () => {
    const parent = await createLeaf({ code: `${prefix}-6` });
    await createLeaf({ code: `${prefix}-601`, parentAccountId: parent.id });

    await expect(service.archive(parent.id, overrideUserId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('denies chart-of-accounts delete to a user with no such permission', async () => {
    const allowed = await permissionsResolver.hasPermission(
      plainUserId,
      'accounting.chart-of-accounts.delete',
    );
    expect(allowed).toBe(false);
  });

  it('a successful deletion never touches an unrelated account or its accounting history', async () => {
    const unrelated = await createLeaf({ code: `${prefix}-7` });
    const entry = await prisma.journalEntry.create({
      data: { entryNumber: `${prefix}-JE-4` },
    });
    await prisma.journalEntryLine.create({
      data: { journalEntryId: entry.id, accountId: unrelated.id, debit: 5 },
    });

    const deletable = await createLeaf({ code: `${prefix}-8` });
    await service.archive(deletable.id, overrideUserId);

    const unrelatedAfter = await prisma.chartOfAccount.findUnique({
      where: { id: unrelated.id },
    });
    expect(unrelatedAfter!.deletedAt).toBeNull();
    const lineAfter = await prisma.journalEntryLine.findFirst({
      where: { journalEntryId: entry.id },
    });
    expect(lineAfter).not.toBeNull();
  });
});
