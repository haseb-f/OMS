import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AccountType, ChartOfAccount } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { AuthModule } from '../auth/auth.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { ChartOfAccountsModule } from './chart-of-accounts.module';
import { ChartOfAccountsService } from './chart-of-accounts.service';

/**
 * R13 spec B1 — chart-of-accounts invariants (Group / Posting, frozen fields
 * once used, restore, post-time re-validation). Real local Postgres, tagged
 * fixtures under a test-only EXPENSE group.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

describeDb('R13 B1 — chart of accounts invariants (local DB)', () => {
  jest.setTimeout(120_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let coa: ChartOfAccountsService;
  let journals: JournalEntriesService;

  const tag = `R13B1-${randomUUID().slice(0, 6).toUpperCase()}`;
  let userId: string;
  let group: ChartOfAccount;
  let journalId: string;
  let seq = 0;

  const code = () => `${tag}-${++seq}`;

  async function account(
    kind: 'GROUP' | 'POSTING',
    parentAccountId: string = group.id,
    accountType: AccountType = AccountType.EXPENSE,
  ) {
    const c = code();
    return coa.create(
      {
        codeOverride: c,
        name: `${c} ${kind}`,
        accountType,
        parentAccountId,
        accountKind: kind,
      },
      userId,
    );
  }

  async function useInJournal(accountId: string) {
    const entry = await prisma.journalEntry.create({
      data: { entryNumber: `${tag}-JE-${++seq}` },
    });
    await prisma.journalEntryLine.create({
      data: { journalEntryId: entry.id, accountId, debit: 1 },
    });
  }

  async function errorOf(work: Promise<unknown>) {
    try {
      await work;
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as
        string | { code?: string; message?: string };
      return typeof body === 'string'
        ? { message: body }
        : { code: body.code, message: String(body.message) };
    }
    throw new Error('Expected a BadRequestException');
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        AuthModule,
        ChartOfAccountsModule,
        JournalEntriesModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    coa = moduleRef.get(ChartOfAccountsService);
    journals = moduleRef.get(JournalEntriesService);

    userId = (
      await prisma.user.create({
        data: {
          email: `${tag.toLowerCase()}@test.local`,
          username: tag.toLowerCase(),
          fullName: `R13 B1 ${tag}`,
          passwordHash: 'x',
        },
      })
    ).id;
    const override = await prisma.permission.findUniqueOrThrow({
      where: { name: 'accounting.chart-of-accounts.override-code' },
    });
    await prisma.userPermission.create({
      data: { userId, permissionId: override.id },
    });
    const root = await coa.ensureSystemRoot(AccountType.EXPENSE);
    group = await coa.create(
      {
        codeOverride: `${tag}-G`,
        name: `${tag} test group`,
        accountType: AccountType.EXPENSE,
        parentAccountId: root.id,
        accountKind: 'GROUP',
      },
      userId,
    );
    journalId = (
      await prisma.journal.findFirstOrThrow({ select: { id: true } })
    ).id;
  });

  afterAll(async () => {
    await prisma.journalEntry.deleteMany({
      where: { entryNumber: { startsWith: tag } },
    });
    const accounts = await prisma.chartOfAccount.findMany({
      where: { code: { startsWith: tag } },
      select: { id: true },
    });
    const ids = accounts.map((a) => a.id);
    const entries = await prisma.journalEntryLine.findMany({
      where: { accountId: { in: ids } },
      select: { journalEntryId: true },
    });
    const entryIds = entries.map((e) => e.journalEntryId);
    await prisma.journalEntryActivity.deleteMany({
      where: { journalEntryId: { in: entryIds } },
    });
    await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    for (let level = 4; level >= 1; level--) {
      await prisma.chartOfAccount.deleteMany({
        where: { id: { in: ids }, level },
      });
    }
    await prisma.userPermission.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await moduleRef.close();
  });

  it('inv 1 — an account is an explicit Group or Posting account (default Posting)', async () => {
    const c = code();
    const leaf = await coa.create(
      {
        codeOverride: c,
        name: `${c} default`,
        accountType: AccountType.EXPENSE,
        parentAccountId: group.id,
      },
      userId,
    );
    expect(leaf.allowsPosting).toBe(true);
    expect((await account('GROUP')).allowsPosting).toBe(false);
  });

  it('inv 2 — a child under a Posting account is rejected; the parent is never flipped', async () => {
    const leaf = await account('POSTING');
    const error = await errorOf(account('POSTING', leaf.id));
    expect(error.code).toBe('PARENT_IS_POSTING');
    expect(error.message).toMatch(/Convert it to a Group account first/);
    const after = await prisma.chartOfAccount.findUniqueOrThrow({
      where: { id: leaf.id },
    });
    expect(after.allowsPosting).toBe(true);
  });

  it('inv 2 — moving an account under a Posting account is rejected', async () => {
    const leaf = await account('POSTING');
    const mover = await account('POSTING');
    const error = await errorOf(
      coa.update(mover.id, { parentAccountId: leaf.id }, userId),
    );
    expect(error.code).toBe('PARENT_IS_POSTING');
  });

  it('inv 2 — Posting → Group only without journal lines; Group → Posting only without children', async () => {
    const used = await account('POSTING');
    await useInJournal(used.id);
    const frozen = await errorOf(
      coa.update(used.id, { accountKind: 'GROUP' }, userId),
    );
    expect(frozen.code).toBe('ACCOUNT_KIND_FROZEN');

    const unused = await account('POSTING');
    const converted = await coa.update(
      unused.id,
      { accountKind: 'GROUP' },
      userId,
    );
    expect(converted.allowsPosting).toBe(false);
    await account('POSTING', unused.id);
    const withChildren = await errorOf(
      coa.update(unused.id, { accountKind: 'POSTING' }, userId),
    );
    expect(withChildren.code).toBe('ACCOUNT_KIND_FROZEN');
  });

  it('inv 2 — archiving the last child leaves the parent a Group', async () => {
    const parent = await account('GROUP');
    const child = await account('POSTING', parent.id);
    await coa.archive(child.id, userId);
    const after = await prisma.chartOfAccount.findUniqueOrThrow({
      where: { id: parent.id },
    });
    expect(after.allowsPosting).toBe(false);
  });

  it('inv 3 — child type must equal the parent type', async () => {
    const error = await errorOf(
      account('POSTING', group.id, AccountType.ASSET),
    );
    expect(error.message).toMatch(/type must match its parent/);
  });

  it('inv 3 — a cycle is rejected', async () => {
    const a = await account('GROUP');
    const b = await account('GROUP', a.id);
    const error = await errorOf(
      coa.update(a.id, { parentAccountId: b.id }, userId),
    );
    expect(error.message).toMatch(/own ancestor/);
  });

  it('inv 3 — a duplicate code is rejected, archived codes included', async () => {
    const existing = await account('POSTING');
    const active = await errorOf(
      coa.create(
        {
          codeOverride: existing.code,
          name: `${tag} dup`,
          accountType: AccountType.EXPENSE,
          parentAccountId: group.id,
        },
        userId,
      ),
    );
    expect(active.code).toBe('DUPLICATE');
    await coa.archive(existing.id, userId);
    const archived = await errorOf(
      coa.create(
        {
          codeOverride: existing.code,
          name: `${tag} dup 2`,
          accountType: AccountType.EXPENSE,
          parentAccountId: group.id,
        },
        userId,
      ),
    );
    expect(archived.message).toMatch(/archived account/);
  });

  it('inv 4 — renaming a used account works when the editor re-sends its unchanged parent / kind / currency', async () => {
    const used = await account('POSTING');
    await useInJournal(used.id);
    const renamed = await coa.update(
      used.id,
      {
        name: `${used.code} renamed`,
        parentAccountId: group.id,
        accountType: AccountType.EXPENSE,
        accountKind: 'POSTING',
        currencyId: undefined,
      },
      userId,
    );
    expect(renamed.name).toBe(`${used.code} renamed`);
  });

  it('inv 4 — a used account cannot move, change type or change currency', async () => {
    const used = await account('POSTING');
    await useInJournal(used.id);
    const otherGroup = await account('GROUP');
    expect(
      (
        await errorOf(
          coa.update(used.id, { parentAccountId: otherGroup.id }, userId),
        )
      ).message,
    ).toMatch(/Parent account cannot be changed/);
    expect(
      (
        await errorOf(
          coa.update(used.id, { accountType: AccountType.ASSET }, userId),
        )
      ).message,
    ).toMatch(/Account type cannot be changed/);
    const currency = await prisma.currency.findFirstOrThrow({
      select: { id: true },
    });
    expect(
      (await errorOf(coa.update(used.id, { currencyId: currency.id }, userId)))
        .code,
    ).toBe('ACCOUNT_CURRENCY_FROZEN');
  });

  it('inv 4 — a system root renames but never converts to Posting', async () => {
    const root = await coa.ensureSystemRoot(AccountType.EXPENSE);
    const error = await errorOf(
      coa.update(root.id, { accountKind: 'POSTING' }, userId),
    );
    expect(error.message).toMatch(/always a Group/);
    const same = await coa.update(
      root.id,
      { name: root.name, parentAccountId: undefined },
      userId,
    );
    expect(same.parentAccountId).toBeNull();
  });

  it('inv 5 — restore requires an active parent', async () => {
    const parent = await account('GROUP');
    const child = await account('POSTING', parent.id);
    await coa.archive(child.id, userId);
    await coa.archive(parent.id, userId);
    const error = await errorOf(coa.restore(child.id, userId));
    expect(error.code).toBe('PARENT_ARCHIVED');
    await coa.restore(parent.id, userId);
    const restored = await coa.restore(child.id, userId);
    expect(restored.deletedAt).toBeNull();
  });

  it('inv 6 — a manual journal on a Posting account posts balanced', async () => {
    const debit = await account('POSTING');
    const credit = await account('POSTING');
    const draft = await journals.create(
      {
        journalId,
        description: `${tag} balanced`,
        lines: [
          { accountId: debit.id, debit: 25 },
          { accountId: credit.id, credit: 25 },
        ],
      },
      userId,
    );
    const posted = await journals.post(draft.id, userId);
    expect(posted.status).toBe('POSTED');
    expect(Number(posted.totalDebit)).toBe(25);
    expect(Number(posted.totalCredit)).toBe(25);
  });

  it('inv 6 — a manual journal draft against a Group account is rejected', async () => {
    const other = await account('POSTING');
    const error = await errorOf(
      journals.create(
        {
          journalId,
          lines: [
            { accountId: group.id, debit: 5 },
            { accountId: other.id, credit: 5 },
          ],
        },
        userId,
      ),
    );
    expect(error.code).toBe('ACCOUNT_NOT_POSTABLE');
  });

  it('inv 6 — manual post re-checks accounts: a draft whose account became Group or archived cannot post', async () => {
    for (const change of [
      { allowsPosting: false },
      { deletedAt: new Date() },
    ]) {
      const debit = await account('POSTING');
      const credit = await account('POSTING');
      const draft = await journals.create(
        {
          journalId,
          lines: [
            { accountId: debit.id, debit: 7 },
            { accountId: credit.id, credit: 7 },
          ],
        },
        userId,
      );
      // Out-of-band change (legacy data / direct maintenance): the post-time
      // check is the last line of defence.
      await prisma.chartOfAccount.update({
        where: { id: debit.id },
        data: change,
      });
      const error = await errorOf(journals.post(draft.id, userId));
      expect(error.code).toBe('ACCOUNT_NOT_POSTABLE');
      const still = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: draft.id },
      });
      expect(still.status).toBe('DRAFT');
    }
  });
});
