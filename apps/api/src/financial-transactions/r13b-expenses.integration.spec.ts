import { readFileSync } from 'fs';
import { join } from 'path';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AccountType,
  AccountingPeriodStatus,
  FinancialTransactionStatus,
  JournalEntryStatus,
  PartnerControlAccountType,
  PartnerRoleType,
  Prisma,
  PurchaseDocumentStatus,
} from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';
import { FxModule } from '../accounting/fx/fx.module';
import {
  candidateRangeQuery,
  pickCovering,
} from '../accounting/fiscal-periods/period-bounds';
import { FinancialTransactionsModule } from './financial-transactions.module';
import { FinancialTransactionsService } from './financial-transactions.service';
import { CreateExpensePaymentDto } from './expenses/dto/create-expense-payment.dto';

/**
 * R13 follow-up (owner decision 2) — the Expenses screen is the expense
 * voucher (FinancialTransaction EXPENSE_PAYMENT). Real local Postgres + the
 * real Posting Engine: draft never posts; Confirm & post books a balanced
 * Dr expense / Cr paid-from entry with the dimensions; replays and double
 * confirms post once; only EXPENSE posting accounts; Cancel reverses and a
 * locked period refuses it; an expense never settles an invoice; the
 * consolidation migration converts / drops legacy rows and maps permissions.
 */
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

const MIGRATION = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20261007110000_r13b_expenses_consolidation/migration.sql',
  ),
  'utf8',
);

function migrationBlock(name: string): string {
  const start = MIGRATION.indexOf(`-- BEGIN ${name}`);
  const end = MIGRATION.indexOf(`-- END ${name}`);
  if (start < 0 || end < 0) throw new Error(`block ${name} not found`);
  return MIGRATION.slice(MIGRATION.indexOf('\n', start) + 1, end);
}

class Rollback extends Error {}

describeDb(
  'R13 owner decision 2 — Expenses = expense vouchers (local DB)',
  () => {
    jest.setTimeout(180_000);
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let transactions: FinancialTransactionsService;

    const tag = `R13EX-${randomUUID().slice(0, 6).toUpperCase()}`;
    let userId: string;
    let expenseAccountId: string;
    let assetAccountId: string;
    let bankAccountId: string;
    let apAccountId: string;
    let receivingAccountId: string;
    let costCenterId: string;
    let projectId: string;
    let supplierId: string;
    let customerId: string;
    let seq = 0;

    async function newAccount(
      accountType: AccountType,
      extra: Partial<Prisma.ChartOfAccountUncheckedCreateInput> = {},
    ) {
      seq += 1;
      return prisma.chartOfAccount.create({
        data: {
          code: `${tag}-${seq}`,
          name: `${tag} ${accountType} ${seq}`,
          accountType,
          level: 2,
          allowsPosting: true,
          ...extra,
        },
      });
    }

    async function partner(role: PartnerRoleType) {
      seq += 1;
      const created = await prisma.partner.create({
        data: {
          partnerNumber: `${tag}-P${seq}`,
          name: `${tag} ${role} ${seq}`,
          roles: { create: { role } },
        },
      });
      if (role === PartnerRoleType.SUPPLIER) {
        await prisma.supplierProfile.create({
          data: { partnerId: created.id, defaultPayableAccountId: apAccountId },
        });
      }
      return created.id;
    }

    async function entries(sourceId: string) {
      return prisma.journalEntry.findMany({
        where: { sourceId, sourceType: 'EXPENSE_PAYMENT', deletedAt: null },
        include: { lines: true },
        orderBy: { createdAt: 'asc' },
      });
    }

    const voucher = (
      amount: number,
      extra: Record<string, unknown> = {},
    ): Parameters<FinancialTransactionsService['create']>[1] => ({
      expenseAccountId,
      receivingAccountId,
      amount,
      description: `${tag} cleaning supplies`,
      ...extra,
    });

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [
          PrismaModule,
          PermissionsCoreModule,
          PhoneModule,
          AuthModule,
          PostingProvidersModule,
          FxModule,
          FinancialTransactionsModule,
        ],
      }).compile();
      await moduleRef.init();
      prisma = moduleRef.get(PrismaService);
      transactions = moduleRef.get(FinancialTransactionsService);

      userId = (
        await prisma.user.create({
          data: {
            email: `${tag.toLowerCase()}@test.local`,
            username: tag.toLowerCase(),
            fullName: `R13 expenses ${tag}`,
            passwordHash: 'x',
          },
        })
      ).id;
      expenseAccountId = (await newAccount(AccountType.EXPENSE)).id;
      assetAccountId = (await newAccount(AccountType.ASSET)).id;
      bankAccountId = (await newAccount(AccountType.ASSET)).id;
      apAccountId = (
        await newAccount(AccountType.LIABILITY, {
          partnerControlType: PartnerControlAccountType.PAYABLE,
        })
      ).id;
      receivingAccountId = (
        await prisma.receivingAccount.create({
          data: {
            name: `${tag} Bank`,
            code: `${tag}-RA`,
            chartOfAccountId: bankAccountId,
          },
        })
      ).id;
      costCenterId = (
        await prisma.costCenter.create({
          data: { code: `${tag}-CC`, name: `${tag} Admin` },
        })
      ).id;
      projectId = (
        await prisma.project.create({
          data: { code: `${tag}-PR`, name: `${tag} Launch` },
        })
      ).id;
      supplierId = await partner(PartnerRoleType.SUPPLIER);
      customerId = await partner(PartnerRoleType.CUSTOMER);
    });

    afterAll(async () => {
      await moduleRef?.close();
    });

    it('a draft never posts', async () => {
      const draft = await transactions.create(
        'EXPENSE_PAYMENT',
        voucher(80),
        userId,
      );
      expect(draft.status).toBe(FinancialTransactionStatus.DRAFT);
      expect(await entries(draft.id)).toHaveLength(0);
    });

    it('Confirm & post: balanced Dr expense / Cr paid-from with dimensions; counterparty is metadata only', async () => {
      const draft = await transactions.create(
        'EXPENSE_PAYMENT',
        voucher(250, { costCenterId, projectId, partnerId: supplierId }),
        userId,
      );
      expect(draft.partnerId).toBe(supplierId);
      expect(draft.description).toBe(`${tag} cleaning supplies`);
      await transactions.confirm(draft.id, userId);

      const [entry, ...rest] = await entries(draft.id);
      expect(rest).toHaveLength(0);
      expect(entry.status).toBe(JournalEntryStatus.POSTED);
      expect(entry.costCenterId).toBe(costCenterId);
      expect(entry.projectId).toBe(projectId);
      expect(Number(entry.totalDebit)).toBe(250);
      expect(Number(entry.totalCredit)).toBe(250);
      const rows = entry.lines.map((l) => [
        l.accountId,
        Number(l.debit),
        Number(l.credit),
      ]);
      expect(rows).toEqual(
        expect.arrayContaining([
          [expenseAccountId, 250, 0],
          [bankAccountId, 0, 250],
        ]),
      );
      expect(entry.lines).toHaveLength(2);
      // Never AP, never a partner line: the supplier is only the counterparty.
      expect(entry.lines.every((l) => l.partnerId === null)).toBe(true);
      expect(entry.lines.some((l) => l.accountId === apAccountId)).toBe(false);
      const expenseLine = entry.lines.find(
        (l) => l.accountId === expenseAccountId,
      );
      expect(expenseLine?.description).toContain(`${tag} cleaning supplies`);
    });

    it('the entry is dated on the expense date (accrual), not the confirmation date', async () => {
      const expenseDate = new Date();
      expenseDate.setUTCDate(expenseDate.getUTCDate() - 3);
      expenseDate.setUTCHours(0, 0, 0, 0);
      const draft = await transactions.create(
        'EXPENSE_PAYMENT',
        voucher(40, { transactionDate: expenseDate.toISOString() }),
        userId,
      );
      await transactions.confirm(draft.id, userId);
      const [entry] = await entries(draft.id);
      expect(entry.entryDate.toISOString().slice(0, 10)).toBe(
        expenseDate.toISOString().slice(0, 10),
      );
    });

    it('double confirm, replayed create and replayed Confirm & post produce one document and one entry', async () => {
      const key = `${tag}-key-1`;
      const first = await transactions.create(
        'EXPENSE_PAYMENT',
        voucher(40, { idempotencyKey: key }),
        userId,
      );
      const replay = await transactions.create(
        'EXPENSE_PAYMENT',
        voucher(40, { idempotencyKey: key }),
        userId,
      );
      expect(replay.id).toBe(first.id);
      await Promise.all([
        transactions.confirm(first.id, userId),
        transactions.confirm(first.id, userId),
      ]);
      await transactions.confirm(first.id, userId);
      expect(await entries(first.id)).toHaveLength(1);

      const postKey = `${tag}-key-2`;
      const [a, b] = await Promise.all([
        transactions.createConfirmed(
          'EXPENSE_PAYMENT',
          voucher(55, { idempotencyKey: postKey }),
          userId,
        ),
        transactions.createConfirmed(
          'EXPENSE_PAYMENT',
          voucher(55, { idempotencyKey: postKey }),
          userId,
        ),
      ]);
      expect(a.id).toBe(b.id);
      const again = await transactions.createConfirmed(
        'EXPENSE_PAYMENT',
        voucher(55, { idempotencyKey: postKey }),
        userId,
      );
      expect(again.id).toBe(a.id);
      expect(await entries(a.id)).toHaveLength(1);
      expect(
        await prisma.financialTransaction.count({
          where: { idempotencyKey: postKey },
        }),
      ).toBe(1);
    });

    it('refuses a non-EXPENSE account on create and on edit, and a non-supplier counterparty', async () => {
      await expect(
        transactions.create(
          'EXPENSE_PAYMENT',
          voucher(10, { expenseAccountId: assetAccountId }),
          userId,
        ),
      ).rejects.toMatchObject({
        response: { code: 'EXPENSE_ACCOUNT_INVALID' },
      });
      const draft = await transactions.create(
        'EXPENSE_PAYMENT',
        voucher(10),
        userId,
      );
      await expect(
        transactions.update(draft.id, { expenseAccountId: assetAccountId }),
      ).rejects.toMatchObject({
        response: { code: 'EXPENSE_ACCOUNT_INVALID' },
      });
      await expect(
        transactions.create(
          'EXPENSE_PAYMENT',
          voucher(10, { partnerId: customerId }),
          userId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('an expense never settles an invoice (service and request DTO)', async () => {
      seq += 1;
      const invoice = await prisma.purchaseInvoice.create({
        data: {
          invoiceNumber: `${tag}-PI${seq}`,
          partnerId: supplierId,
          status: PurchaseDocumentStatus.CONFIRMED,
          subtotal: 300,
          grandTotal: 300,
          confirmedAt: new Date(),
        },
      });
      const allocation = [{ invoiceId: invoice.id, allocatedAmount: 100 }];
      await expect(
        transactions.create(
          'EXPENSE_PAYMENT',
          voucher(100, { partnerId: supplierId, allocations: allocation }),
          userId,
        ),
      ).rejects.toMatchObject({
        response: { code: 'EXPENSE_ALLOCATION_REFUSED' },
      });
      const draft = await transactions.create(
        'EXPENSE_PAYMENT',
        voucher(100, { partnerId: supplierId }),
        userId,
      );
      await expect(
        transactions.update(draft.id, { allocations: allocation }),
      ).rejects.toMatchObject({
        response: { code: 'EXPENSE_ALLOCATION_REFUSED' },
      });
      await transactions.confirm(draft.id, userId);
      await expect(
        transactions.allocate(draft.id, allocation[0], userId),
      ).rejects.toMatchObject({
        response: { code: 'EXPENSE_ALLOCATION_REFUSED' },
      });
      expect(
        await prisma.financialTransactionAllocation.count({
          where: { purchaseInvoiceId: invoice.id },
        }),
      ).toBe(0);

      // The request body cannot carry allocations either (not silently stripped).
      const dto = plainToInstance(CreateExpensePaymentDto, {
        expenseAccountId,
        amount: 100,
        allocations: allocation,
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toContain('allocations');

      // The open invoice is offered for "Pay invoice instead".
      const open = await transactions.getOpenInvoices(
        'SUPPLIER_PAYMENT',
        supplierId,
      );
      expect(open.map((row) => row.invoiceId)).toContain(invoice.id);
    });

    it('Cancel posts the reversal entry; a locked period refuses it', async () => {
      const posted = await transactions.createConfirmed(
        'EXPENSE_PAYMENT',
        voucher(70, { costCenterId }),
        userId,
      );

      // Locked period: lock (inside a rolled-back transaction) the period that
      // covers today — the reversal date — and try to cancel there.
      await expect(
        prisma.$transaction(async (tx) => {
          const now = new Date();
          const covering = pickCovering(
            await tx.accountingPeriod.findMany(candidateRangeQuery(now)),
            now,
          );
          if (covering) {
            await tx.accountingPeriod.update({
              where: { id: covering.id },
              data: { status: AccountingPeriodStatus.LOCKED },
            });
          } else {
            const year = await tx.fiscalYear.create({
              data: {
                name: `${tag} FY`,
                startDate: new Date(now.getTime() - 86_400_000),
                endDate: new Date(now.getTime() + 86_400_000),
              },
            });
            await tx.accountingPeriod.create({
              data: {
                name: `${tag} locked`,
                fiscalYearId: year.id,
                startDate: new Date(now.getTime() - 86_400_000),
                endDate: new Date(now.getTime() + 86_400_000),
                status: AccountingPeriodStatus.LOCKED,
              },
            });
          }
          await expect(
            transactions.cancelInTx(tx, posted.id, userId),
          ).rejects.toThrow(/LOCKED/);
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
      expect(
        await prisma.financialTransaction
          .findUniqueOrThrow({
            where: { id: posted.id },
          })
          .then((row) => row.status),
      ).toBe(FinancialTransactionStatus.CONFIRMED);
      expect(await entries(posted.id)).toHaveLength(1);

      const cancelled = await transactions.cancel(posted.id, userId);
      expect(cancelled.status).toBe(FinancialTransactionStatus.CANCELLED);
      const [original, reversal] = await entries(posted.id);
      expect(original.status).toBe(JournalEntryStatus.REVERSED);
      expect(reversal.reversalOfEntryId).toBe(original.id);
      expect(reversal.costCenterId).toBe(costCenterId);
      const mirrored = reversal.lines.map((l) => [
        l.accountId,
        Number(l.debit),
        Number(l.credit),
      ]);
      expect(mirrored).toEqual(
        expect.arrayContaining([
          [expenseAccountId, 0, 70],
          [bankAccountId, 70, 0],
        ]),
      );
    });

    it('list filters by account / paid from and totals per currency exclude reversed vouchers', async () => {
      const otherExpense = (await newAccount(AccountType.EXPENSE)).id;
      const kept = await transactions.createConfirmed(
        'EXPENSE_PAYMENT',
        voucher(30, { expenseAccountId: otherExpense }),
        userId,
      );
      const reversed = await transactions.createConfirmed(
        'EXPENSE_PAYMENT',
        voucher(45, { expenseAccountId: otherExpense }),
        userId,
      );
      await transactions.cancel(reversed.id, userId);
      await transactions.create(
        'EXPENSE_PAYMENT',
        voucher(5, { expenseAccountId: otherExpense }),
        userId,
      );

      const list = await transactions.findAll('EXPENSE_PAYMENT', {
        expenseAccountId: [otherExpense],
        receivingAccountId: [receivingAccountId],
      });
      expect(list.total).toBe(3);
      expect(list.items.map((row) => row.id)).toContain(kept.id);

      const totals = await transactions.totalsByCurrency('EXPENSE_PAYMENT', {
        expenseAccountId: [otherExpense],
      });
      expect(totals).toHaveLength(1);
      expect(totals[0].count).toBe(2);
      expect(totals[0].amount).toBe(35);
    });

    it('migration: converts usable legacy rows to drafts, drops the rest, maps permissions (rolled back)', async () => {
      await expect(
        prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`
            CREATE TABLE "expenses" (
              "id" UUID PRIMARY KEY,
              "date" DATE NOT NULL,
              "amount" DECIMAL(12,2) NOT NULL,
              "description" TEXT NOT NULL,
              "cost_center_id" UUID,
              "payment_method_id" UUID,
              "notes" TEXT,
              "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updated_at" TIMESTAMP(3) NOT NULL,
              "created_by" UUID,
              "updated_by" UUID,
              "deleted_at" TIMESTAMP(3)
            )`);
            const paymentMethod = await tx.paymentMethod.create({
              data: { name: `${tag} Bank transfer`, accountId: bankAccountId },
            });
            const usable = randomUUID();
            await tx.$executeRaw`
            INSERT INTO "expenses" ("id","date","amount","description","cost_center_id","payment_method_id","notes","updated_at")
            VALUES (${usable}::uuid, '2026-09-15', 120, 'Printer paper', ${costCenterId}::uuid, ${paymentMethod.id}::uuid, 'legacy', now()),
                   (gen_random_uuid(), '2026-09-16', 0, 'Zero amount', NULL, NULL, NULL, now())`;
            await tx.$executeRaw`
            INSERT INTO "expenses" ("id","date","amount","description","updated_at","deleted_at")
            VALUES (gen_random_uuid(), '2026-09-17', 15, 'Archived', now(), now())`;

            // No resolvable expense account → nothing converts.
            const settings = await tx.postingSettings.findFirst();
            if (settings) {
              await tx.postingSettings.update({
                where: { id: settings.id },
                data: { defaultExpenseAccountId: assetAccountId },
              });
            }
            await tx.$executeRawUnsafe(migrationBlock('legacy-conversion'));
            expect(
              await tx.financialTransaction.count({ where: { id: usable } }),
            ).toBe(0);

            // An EXPENSE posting default → the one usable row converts.
            if (settings) {
              await tx.postingSettings.update({
                where: { id: settings.id },
                data: { defaultExpenseAccountId: expenseAccountId },
              });
            } else {
              await tx.postingSettings.create({
                data: { defaultExpenseAccountId: expenseAccountId },
              });
            }
            await tx.$executeRawUnsafe(migrationBlock('legacy-conversion'));
            const converted = await tx.financialTransaction.findMany({
              where: { transactionNumber: { startsWith: 'EP-LEGACY-' } },
            });
            expect(converted).toHaveLength(1);
            const [row] = converted;
            expect(row.id).toBe(usable);
            expect(row.type).toBe('EXPENSE_PAYMENT');
            expect(row.status).toBe(FinancialTransactionStatus.DRAFT);
            expect(row.expenseAccountId).toBe(expenseAccountId);
            expect(row.costCenterId).toBe(costCenterId);
            expect(row.receivingAccountId).toBe(receivingAccountId);
            expect(Number(row.amount)).toBe(120);
            expect(row.description).toBe('Printer paper');
            expect(
              await tx.journalEntry.count({ where: { sourceId: usable } }),
            ).toBe(0);

            // Permission mapping: view/create/edit/archive carry over, posting does not.
            const legacyView = await tx.permission.upsert({
              where: { name: 'masterdata.expenses.view' },
              update: {},
              create: { name: 'masterdata.expenses.view' },
            });
            const legacyEdit = await tx.permission.upsert({
              where: { name: 'masterdata.expenses.edit' },
              update: {},
              create: { name: 'masterdata.expenses.edit' },
            });
            await tx.userPermission.createMany({
              data: [
                { userId, permissionId: legacyView.id },
                { userId, permissionId: legacyEdit.id },
              ],
            });
            for (const statement of migrationBlock('permission-mapping')
              .split(/;\s*\n/)
              .map((part) => part.trim())
              .filter(Boolean)) {
              await tx.$executeRawUnsafe(statement);
            }
            const granted = (
              await tx.userPermission.findMany({
                where: { userId },
                include: { permission: true },
              })
            )
              .map((row) => row.permission.name)
              .sort();
            expect(granted).toEqual([
              'accounting.expense-payments.edit',
              'accounting.expense-payments.view',
            ]);
            expect(
              await tx.permission.count({
                where: { name: { startsWith: 'masterdata.expenses.' } },
              }),
            ).toBe(0);
            throw new Rollback();
          },
          { timeout: 60_000 },
        ),
      ).rejects.toBeInstanceOf(Rollback);
      expect(
        await prisma.financialTransaction.count({
          where: { transactionNumber: { startsWith: 'EP-LEGACY-' } },
        }),
      ).toBe(0);
    });
  },
);
