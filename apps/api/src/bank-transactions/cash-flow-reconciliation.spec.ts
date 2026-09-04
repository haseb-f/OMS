import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ProductType,
  SalesDocumentStatus,
  PurchaseDocumentStatus,
  AccountType,
  PartnerRoleType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BankTransactionsModule } from './bank-transactions.module';
import { BankTransactionsService } from './bank-transactions.service';
import { CashFlowReconciliationService } from './cash-flow-reconciliation.service';
import { StoreOrdersImportHandler } from '../import-center/handlers/store-orders-import.handler';
import { ImportCenterModule } from '../import-center/import-center.module';
import { StoreOrderPaymentSyncService } from '../store-orders/store-order-payment-sync.service';
import { PaymentsService } from '../payments/payments.service';
import { PartnersService } from '../partners/partners.service';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { PhoneModule } from '../common/phone/phone.module';
import { AuthModule } from '../auth/auth.module';
import { PostingProvidersModule } from '../accounting/posting-providers/posting-providers.module';

/**
 * Cash Flow Reconciliation — the money-critical scenarios from the Cash
 * Flow module spec (idempotency, Store Order/B2B/Purchase Invoice/Expense
 * reconciliation, correct debit/credit posting direction, conflict
 * detection). Runs against the real local Postgres, exercising the actual
 * `BankTransactionsService`/`CashFlowReconciliationService`/
 * `FinancialTransactionsService`/`PostingEngineService` — never a mocked
 * Prisma — since the behavior under test (idempotency, posting direction,
 * permission-gated reconciliation) is exactly what would be mocked away.
 */
describe('Cash Flow Reconciliation', () => {
  jest.setTimeout(180_000);
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let bankTransactions: BankTransactionsService;
  let reconciliation: CashFlowReconciliationService;
  let storeOrdersHandler: StoreOrdersImportHandler;
  let paymentsService: PaymentsService;
  let partnersService: PartnersService;

  let categoryId: string;
  let unitId: string;
  let currencyId: string;
  let currencyCode: string;
  let productSku: string;
  // Store Orders resolve the Product column by display name, never by SKU —
  // the name has to be unique per run or a leftover product from an earlier
  // run makes the lookup ambiguous.
  let productName: string;
  let paymentSourceId: string;
  let cashSourceId: string; // ReceivingAccount
  let expenseAccountId: string; // ChartOfAccount (EXPENSE)
  let bankChartAccountId: string;
  let supplierId: string;
  let sharedCustomerId: string;
  let testUserId: string;
  let testUserEmail: string;
  let countryName: string;
  let paymentMethodLabel: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        ImportCenterModule,
        BankTransactionsModule,
        PostingProvidersModule,
      ],
    }).compile();
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    bankTransactions = moduleRef.get(BankTransactionsService);
    reconciliation = moduleRef.get(CashFlowReconciliationService);
    storeOrdersHandler = moduleRef.get(StoreOrdersImportHandler);
    paymentsService = moduleRef.get(PaymentsService);
    partnersService = moduleRef.get(PartnersService);
    void moduleRef.get(StoreOrderPaymentSyncService);

    const category = await prisma.productCategory.create({
      data: { name: `Cash Flow Test Category ${randomUUID()}` },
    });
    categoryId = category.id;

    const unit = await prisma.unit.create({
      data: { name: `Cash Flow Test Unit ${randomUUID()}` },
    });
    unitId = unit.id;

    const currency = await prisma.currency.findFirst();
    if (!currency) throw new Error('Expected at least one seeded Currency.');
    currencyId = currency.id;
    currencyCode = currency.code;

    productSku = `CASHFLOW-TEST-${randomUUID().slice(0, 8)}`;
    productName = `Cash Flow Test Product ${productSku}`;
    await prisma.product.create({
      data: {
        name: productName,
        internalName: productName,
        displayName: productName,
        sku: productSku,
        categoryId,
        unitId,
        type: ProductType.SERVICE,
        isPurchasable: false,
        isSellable: true,
        isInventoryItem: false,
      },
    });

    const paymentSource = await prisma.paymentSource.findFirst({
      where: { isActive: true },
    });
    if (!paymentSource)
      throw new Error('Expected at least one seeded active PaymentSource.');
    paymentSourceId = paymentSource.id;

    const bankAccount = await prisma.chartOfAccount.create({
      data: {
        code: `CFTEST-BANK-${randomUUID().slice(0, 6)}`,
        name: 'Cash Flow Test Bank Account',
        accountType: AccountType.ASSET,
      },
    });
    bankChartAccountId = bankAccount.id;

    const receivingAccount = await prisma.receivingAccount.create({
      data: {
        name: 'Cash Flow Test Cash Source',
        code: `CFTEST-RA-${randomUUID().slice(0, 6)}`,
        chartOfAccountId: bankChartAccountId,
      },
    });
    cashSourceId = receivingAccount.id;

    const expenseAccount = await prisma.chartOfAccount.create({
      data: {
        code: `CFTEST-EXP-${randomUUID().slice(0, 6)}`,
        name: 'Cash Flow Test Marketing Expense',
        accountType: AccountType.EXPENSE,
      },
    });
    expenseAccountId = expenseAccount.id;

    const supplier = await partnersService.create({
      name: 'Cash Flow Test Supplier',
      roles: [PartnerRoleType.SUPPLIER],
    });
    supplierId = supplier.id;

    const suffix = randomUUID().slice(0, 8);
    const user = await prisma.user.create({
      data: {
        email: `cash-flow-test-${suffix}@example.test`,
        username: `cash-flow-test-${suffix}`,
        fullName: 'Cash Flow Tester',
        passwordHash: 'x',
        isSuperAdmin: false,
      },
    });
    testUserId = user.id;
    testUserEmail = user.email;

    const country = await prisma.country.findFirstOrThrow({
      where: { deletedAt: null, isActive: true, code: 'SA' },
    });
    countryName = country.name;

    const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({
      where: { deletedAt: null },
    });
    paymentMethodLabel = paymentMethod.name;

    // One shared Customer (created via a real Store Order import so it goes
    // through the real CustomersService.findOrCreate) reused for both the
    // Store Order tests and the B2B Sales Invoice fixture below.
    const order = await storeOrdersHandler.importRow(
      storeOrderRow({ paidAmount: '1000' }),
    );
    const created = await prisma.storeOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    sharedCustomerId = created.partnerId;
  });

  afterAll(async () => {
    // `storeOrderRow()` mints a fresh random phone number every call, so
    // each Store Order fixture created across these tests belongs to its
    // OWN new Customer (via CustomersService.findOrCreate) — never just
    // `sharedCustomerId`. Sweep up every one of them by the fixture's fixed
    // name, the same "tag it distinctively, clean up by that tag" pattern
    // `data-synchronization.spec.ts` already established.
    const customers = await prisma.partner.findMany({
      where: { name: 'Cash Flow Test Customer' },
      select: { id: true },
    });
    const customerIds = [
      ...new Set([...customers.map((c) => c.id), sharedCustomerId]),
    ].filter((id): id is string => Boolean(id));
    if (!customerIds.length) {
      await prisma.$disconnect();
      if (moduleRef) await moduleRef.close();
      return;
    }
    const orders = await prisma.storeOrder.findMany({
      where: { partnerId: { in: customerIds } },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    const bankTxns = await prisma.bankTransaction.findMany({
      where: { cashSourceId },
      select: { id: true, matchedFinancialTransactionId: true },
    });
    const financialTransactionIds = bankTxns
      .map((t) => t.matchedFinancialTransactionId)
      .filter((id): id is string => !!id);

    await prisma.bankTransaction.deleteMany({ where: { cashSourceId } });

    if (financialTransactionIds.length) {
      const journalEntries = await prisma.journalEntry.findMany({
        where: { sourceId: { in: financialTransactionIds } },
        select: { id: true },
      });
      await prisma.journalEntryLine.deleteMany({
        where: { journalEntryId: { in: journalEntries.map((j) => j.id) } },
      });
      await prisma.journalEntryActivity.deleteMany({
        where: { journalEntryId: { in: journalEntries.map((j) => j.id) } },
      });
      await prisma.journalEntry.deleteMany({
        where: { id: { in: journalEntries.map((j) => j.id) } },
      });
      await prisma.financialTransactionActivity.deleteMany({
        where: { transactionId: { in: financialTransactionIds } },
      });
      await prisma.financialTransactionAllocation.deleteMany({
        where: { transactionId: { in: financialTransactionIds } },
      });
      await prisma.financialTransaction.deleteMany({
        where: { id: { in: financialTransactionIds } },
      });
    }

    await prisma.salesInvoice.deleteMany({
      where: { partnerId: { in: customerIds } },
    });
    await prisma.purchaseInvoice.deleteMany({
      where: { partnerId: supplierId },
    });

    // Sweep by receiving account as well as by store order: the supplier
    // payment and expense voucher scenarios create Payments with no
    // storeOrderId, and those still reference the ReceivingAccount deleted
    // below, which otherwise fails on `payments_receiving_account_id_fkey`.
    const payments = await prisma.payment.findMany({
      where: {
        OR: [
          { storeOrderId: { in: orderIds } },
          { receivingAccountId: cashSourceId },
        ],
      },
      select: { id: true },
    });
    const paymentIds = payments.map((p) => p.id);
    await prisma.paymentActivity.deleteMany({
      where: { paymentId: { in: paymentIds } },
    });
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.storeOrderActivity.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrderItem.deleteMany({
      where: { storeOrderId: { in: orderIds } },
    });
    await prisma.storeOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.masterDataActivityLog.deleteMany({
      where: {
        entityType: 'PARTNER',
        entityId: { in: [...customerIds, supplierId] },
      },
    });
    await prisma.customerProfile.deleteMany({
      where: { partnerId: { in: customerIds } },
    });
    await prisma.partnerRoleAssignment.deleteMany({
      where: { partnerId: { in: [...customerIds, supplierId] } },
    });
    await prisma.partner.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.supplierProfile.deleteMany({
      where: { partnerId: supplierId },
    });
    await prisma.partner.deleteMany({ where: { id: supplierId } });

    await prisma.receivingAccount.deleteMany({ where: { id: cashSourceId } });
    await prisma.chartOfAccount.deleteMany({
      where: { id: { in: [expenseAccountId, bankChartAccountId] } },
    });
    await prisma.product.deleteMany({ where: { sku: productSku } });
    await prisma.productCategory.deleteMany({ where: { id: categoryId } });
    await prisma.unit.deleteMany({ where: { id: unitId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });

    await moduleRef.close();
  });

  function storeOrderRow(overrides: Partial<Record<string, string>> = {}) {
    return {
      externalOrderId: `CF-EXT-${randomUUID()}`,
      orderDate: '2026-08-01',
      customerName: 'Cash Flow Test Customer',
      customerPhone: `+9665${Math.floor(10000000 + Math.random() * 89999999)}`,
      countryName,
      address: 'Test address',
      productSku: productName,
      quantity: '1',
      paidAmount: '1000',
      currencyCode,
      paymentMethodLabel,
      agentEmail: testUserEmail,
      ...overrides,
    };
  }

  /** Directly exercises `BankTransactionsService.upsertFromImport` — the exact write path `BankTransactionsImportHandler` uses. */
  async function importIncoming(
    overrides: Partial<
      Parameters<typeof bankTransactions.upsertFromImport>[0]
    > = {},
  ) {
    const transactionId = overrides.transactionId ?? `TXN-${randomUUID()}`;
    return bankTransactions.upsertFromImport({
      fingerprint: `fp-${randomUUID()}`,
      transactionId,
      transactionDate: new Date(),
      amount: 1000,
      currencyId,
      cashSourceId,
      direction: 'INCOMING',
      ...overrides,
    });
  }

  async function importOutgoing(
    overrides: Partial<
      Parameters<typeof bankTransactions.upsertFromImport>[0]
    > = {},
  ) {
    const transactionId = overrides.transactionId ?? `TXN-${randomUUID()}`;
    return bankTransactions.upsertFromImport({
      fingerprint: `fp-${randomUUID()}`,
      transactionId,
      transactionDate: new Date(),
      amount: -1000,
      currencyId,
      cashSourceId,
      direction: 'OUTGOING',
      ...overrides,
    });
  }

  // -------------------------------------------------------------------
  // 1. Idempotency / duplicate External Transaction ID / re-sync
  // -------------------------------------------------------------------

  describe('idempotency', () => {
    it('never creates a second row for the same [cashSourceId, transactionId] on re-sync', async () => {
      const transactionId = `TXN-DUP-${randomUUID()}`;
      const first = await importIncoming({ transactionId, amount: 250 });
      const second = await importIncoming({ transactionId, amount: 250 });
      expect(second.id).toBe(first.id);

      const count = await prisma.bankTransaction.count({
        where: { cashSourceId, transactionId },
      });
      expect(count).toBe(1);
    });

    it('flags CONFLICT — never silently overwrites — when an already-reconciled row changes materially on re-sync, and creates no duplicate Journal Entry', async () => {
      const transactionId = `TXN-CONFLICT-${randomUUID()}`;
      const created = await importOutgoing({ transactionId, amount: -500 });
      await reconciliation.confirmExpenseVoucher(
        created.id,
        { expenseAccountId, paymentSourceId },
        testUserId,
        { companyId: null, branchId: null },
      );
      const reconciled = await prisma.bankTransaction.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(reconciled.matchedFinancialTransactionId).toBeTruthy();

      const journalCountBefore = await prisma.journalEntry.count({
        where: { sourceId: reconciled.matchedFinancialTransactionId! },
      });
      expect(journalCountBefore).toBe(1);

      // Re-sync the SAME external id with a DIFFERENT amount.
      const resynced = await importOutgoing({ transactionId, amount: -750 });
      expect(resynced.conflict).toBe(true);
      const afterConflict = await prisma.bankTransaction.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(afterConflict.matchStatus).toBe('CONFLICT');
      // The original reconciled amount is untouched — accounting history is immutable.
      expect(Number(afterConflict.amount)).toBe(-500);
      expect(afterConflict.matchedFinancialTransactionId).toBe(
        reconciled.matchedFinancialTransactionId,
      );

      const journalCountAfter = await prisma.journalEntry.count({
        where: { sourceId: reconciled.matchedFinancialTransactionId! },
      });
      expect(journalCountAfter).toBe(1);
    });

    it('is a true no-op — never re-touches an already-reconciled row — when the re-synced data is identical', async () => {
      const transactionId = `TXN-NOOP-${randomUUID()}`;
      const created = await importOutgoing({ transactionId, amount: -300 });
      await reconciliation.confirmExpenseVoucher(
        created.id,
        { expenseAccountId, paymentSourceId },
        testUserId,
        { companyId: null, branchId: null },
      );
      const before = await prisma.bankTransaction.findUniqueOrThrow({
        where: { id: created.id },
      });

      const resynced = await importOutgoing({ transactionId, amount: -300 });
      expect(resynced.conflict).toBe(false);
      const after = await prisma.bankTransaction.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(after.matchStatus).toBe(before.matchStatus);
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    });
  });

  // -------------------------------------------------------------------
  // 2. Incoming -> Store Orders (full / partial / multiple payments)
  // -------------------------------------------------------------------

  describe('incoming -> Store Orders', () => {
    it('reaches FULLY_PAID_RECONCILED on a single full-amount incoming transaction', async () => {
      const order = await storeOrdersHandler.importRow(
        storeOrderRow({ paidAmount: '1000' }),
      );
      const txn = await importIncoming({ amount: 1000 });
      const userId = testUserId;

      const result = await reconciliation.confirmStoreOrderPayment(
        txn.id,
        { storeOrderId: order.id, paymentSourceId },
        userId,
      );
      expect(result.matchedPaymentId).toBeTruthy();
      await paymentsService.verify(result.matchedPaymentId!, {
        verifiedById: userId,
      });

      const finalOrder = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(finalOrder.paymentStatus).toBe('FULLY_PAID_RECONCILED');
    });

    it('reaches PARTIALLY_PAID on a partial-amount incoming transaction', async () => {
      const order = await storeOrdersHandler.importRow(
        storeOrderRow({ paidAmount: '1000' }),
      );
      const txn = await importIncoming({ amount: 400 });
      const userId = testUserId;

      const result = await reconciliation.confirmStoreOrderPayment(
        txn.id,
        { storeOrderId: order.id, paymentSourceId },
        userId,
      );
      await paymentsService.verify(result.matchedPaymentId!, {
        verifiedById: userId,
      });

      const finalOrder = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(finalOrder.paymentStatus).toBe('PARTIALLY_PAID');
    });

    it('recognizes multiple incoming transactions belonging to the same Store Order', async () => {
      const order = await storeOrdersHandler.importRow(
        storeOrderRow({ paidAmount: '1000' }),
      );
      const userId = testUserId;

      const first = await importIncoming({ amount: 500 });
      const r1 = await reconciliation.confirmStoreOrderPayment(
        first.id,
        { storeOrderId: order.id, paymentSourceId },
        userId,
      );
      await paymentsService.verify(r1.matchedPaymentId!, {
        verifiedById: userId,
      });

      const second = await importIncoming({ amount: 300 });
      const r2 = await reconciliation.confirmStoreOrderPayment(
        second.id,
        { storeOrderId: order.id, paymentSourceId },
        userId,
      );
      await paymentsService.verify(r2.matchedPaymentId!, {
        verifiedById: userId,
      });

      let finalOrder = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(finalOrder.paymentStatus).toBe('PARTIALLY_PAID');

      const third = await importIncoming({ amount: 200 });
      const r3 = await reconciliation.confirmStoreOrderPayment(
        third.id,
        { storeOrderId: order.id, paymentSourceId },
        userId,
      );
      await paymentsService.verify(r3.matchedPaymentId!, {
        verifiedById: userId,
      });

      finalOrder = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(finalOrder.paymentStatus).toBe('FULLY_PAID_RECONCILED');

      const payments = await prisma.payment.count({
        where: { storeOrderId: order.id },
      });
      expect(payments).toBe(3);
    });

    it('never lets an already-reconciled Bank Transaction be reconciled a second time', async () => {
      const order = await storeOrdersHandler.importRow(
        storeOrderRow({ paidAmount: '1000' }),
      );
      const txn = await importIncoming({ amount: 1000 });
      await reconciliation.confirmStoreOrderPayment(
        txn.id,
        { storeOrderId: order.id, paymentSourceId },
        testUserId,
      );
      await expect(
        reconciliation.confirmStoreOrderPayment(
          txn.id,
          { storeOrderId: order.id, paymentSourceId },
          testUserId,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------
  // 3. Incoming -> B2B Sales Invoices (full / partial / multiple)
  // -------------------------------------------------------------------

  describe('incoming -> B2B Sales Invoices', () => {
    async function createInvoice(grandTotal: number, currency = currencyId) {
      return prisma.salesInvoice.create({
        data: {
          invoiceNumber: `CF-SI-${randomUUID()}`,
          partnerId: sharedCustomerId,
          currencyId: currency,
          status: SalesDocumentStatus.CONFIRMED,
          grandTotal,
        },
      });
    }

    it('fully settles a B2B invoice with one matching incoming transaction, posting Dr Bank / Cr AR', async () => {
      const invoice = await createInvoice(1000);
      const txn = await importIncoming({ amount: 1000 });

      const result = await reconciliation.confirmSalesInvoiceReceipt(
        txn.id,
        {
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 1000 }],
          paymentSourceId,
        },
        testUserId,
        { companyId: null, branchId: null },
      );
      expect(result.matchedFinancialTransactionId).toBeTruthy();

      const lines = await prisma.journalEntryLine.findMany({
        where: {
          journalEntry: { sourceId: result.matchedFinancialTransactionId! },
        },
      });
      expect(lines).toHaveLength(2);
      const bankLine = lines.find((l) => l.accountId === bankChartAccountId);
      expect(bankLine).toBeTruthy();
      expect(Number(bankLine!.debit)).toBe(1000);
      const arLine = lines.find((l) => l.id !== bankLine!.id);
      expect(Number(arLine!.credit)).toBe(1000);
    });

    it('supports a partial payment against a B2B invoice', async () => {
      const invoice = await createInvoice(1000);
      const txn = await importIncoming({ amount: 400 });

      await reconciliation.confirmSalesInvoiceReceipt(
        txn.id,
        {
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 400 }],
          paymentSourceId,
        },
        testUserId,
        { companyId: null, branchId: null },
      );

      const openInvoices =
        await prisma.financialTransactionAllocation.aggregate({
          where: { salesInvoiceId: invoice.id },
          _sum: { allocatedAmount: true },
        });
      expect(Number(openInvoices._sum.allocatedAmount)).toBe(400);
    });

    it('supports multiple incoming transactions settling one B2B invoice', async () => {
      const invoice = await createInvoice(1000);

      const first = await importIncoming({ amount: 600 });
      await reconciliation.confirmSalesInvoiceReceipt(
        first.id,
        {
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 600 }],
          paymentSourceId,
        },
        testUserId,
        { companyId: null, branchId: null },
      );
      const second = await importIncoming({ amount: 400 });
      await reconciliation.confirmSalesInvoiceReceipt(
        second.id,
        {
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 400 }],
          paymentSourceId,
        },
        testUserId,
        { companyId: null, branchId: null },
      );

      const total = await prisma.financialTransactionAllocation.aggregate({
        where: { salesInvoiceId: invoice.id },
        _sum: { allocatedAmount: true },
      });
      expect(Number(total._sum.allocatedAmount)).toBe(1000);
    });

    it('excludes a currency-mismatched invoice from suggested candidates', async () => {
      const otherCurrency = await prisma.currency.findFirst({
        where: { id: { not: currencyId } },
      });
      if (!otherCurrency) return; // only one currency seeded — nothing to assert
      const invoice = await createInvoice(1000, otherCurrency.id);
      const txn = await importIncoming({
        amount: 1000,
        reference: invoice.invoiceNumber,
        currencyId,
      });
      const { candidates } = await reconciliation.suggestIncoming(txn.id);
      expect(candidates.some((c) => c.id === invoice.id)).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // 4. Outgoing -> Supplier Payment -> Purchase Invoices
  // -------------------------------------------------------------------

  describe('outgoing -> Supplier Payment -> Purchase Invoices', () => {
    async function createPurchaseInvoice(grandTotal: number) {
      return prisma.purchaseInvoice.create({
        data: {
          invoiceNumber: `CF-PI-${randomUUID()}`,
          partnerId: supplierId,
          currencyId,
          status: PurchaseDocumentStatus.CONFIRMED,
          grandTotal,
        },
      });
    }

    it('fully settles a Purchase Invoice, posting Dr AP / Cr Bank with the correct amount', async () => {
      const invoice = await createPurchaseInvoice(800);
      const txn = await importOutgoing({ amount: -800 });
      await reconciliation.classifyOutgoing(txn.id, {
        outgoingType: 'SUPPLIER_PAYMENT',
        partnerId: supplierId,
      });

      const result = await reconciliation.confirmPurchaseInvoicePayment(
        txn.id,
        {
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 800 }],
          paymentSourceId,
        },
        testUserId,
        { companyId: null, branchId: null },
      );

      const lines = await prisma.journalEntryLine.findMany({
        where: {
          journalEntry: { sourceId: result.matchedFinancialTransactionId! },
        },
      });
      expect(lines).toHaveLength(2);
      const bankLine = lines.find((l) => l.accountId === bankChartAccountId)!;
      expect(Number(bankLine.credit)).toBe(800);
      const apLine = lines.find((l) => l.id !== bankLine.id)!;
      expect(Number(apLine.debit)).toBe(800);
    });

    it('supports a partial supplier payment', async () => {
      const invoice = await createPurchaseInvoice(800);
      const txn = await importOutgoing({ amount: -300 });
      await reconciliation.classifyOutgoing(txn.id, {
        outgoingType: 'SUPPLIER_PAYMENT',
        partnerId: supplierId,
      });
      await reconciliation.confirmPurchaseInvoicePayment(
        txn.id,
        {
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 300 }],
          paymentSourceId,
        },
        testUserId,
        { companyId: null, branchId: null },
      );

      const total = await prisma.financialTransactionAllocation.aggregate({
        where: { purchaseInvoiceId: invoice.id },
        _sum: { allocatedAmount: true },
      });
      expect(Number(total._sum.allocatedAmount)).toBe(300);
    });

    it('supports multiple outgoing payments settling one Purchase Invoice', async () => {
      const invoice = await createPurchaseInvoice(800);

      const first = await importOutgoing({ amount: -500 });
      await reconciliation.classifyOutgoing(first.id, {
        outgoingType: 'SUPPLIER_PAYMENT',
        partnerId: supplierId,
      });
      await reconciliation.confirmPurchaseInvoicePayment(
        first.id,
        {
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 500 }],
          paymentSourceId,
        },
        testUserId,
        { companyId: null, branchId: null },
      );

      const second = await importOutgoing({ amount: -300 });
      await reconciliation.classifyOutgoing(second.id, {
        outgoingType: 'SUPPLIER_PAYMENT',
        partnerId: supplierId,
      });
      await reconciliation.confirmPurchaseInvoicePayment(
        second.id,
        {
          allocations: [{ invoiceId: invoice.id, allocatedAmount: 300 }],
          paymentSourceId,
        },
        testUserId,
        { companyId: null, branchId: null },
      );

      const total = await prisma.financialTransactionAllocation.aggregate({
        where: { purchaseInvoiceId: invoice.id },
        _sum: { allocatedAmount: true },
      });
      expect(Number(total._sum.allocatedAmount)).toBe(800);
    });
  });

  // -------------------------------------------------------------------
  // 5. Outgoing -> Expense -> Payment Voucher
  // -------------------------------------------------------------------

  describe('outgoing -> Expense -> Payment Voucher', () => {
    it('posts Dr Expense / Cr Bank for the exact transaction amount (spec section 12 worked example)', async () => {
      const txn = await importOutgoing({
        amount: -1000,
        expenseAccountId,
        outgoingType: 'EXPENSE',
      });

      const result = await reconciliation.confirmExpenseVoucher(
        txn.id,
        { paymentSourceId },
        testUserId,
        { companyId: null, branchId: null },
      );
      expect(result.matchedFinancialTransactionId).toBeTruthy();

      const lines = await prisma.journalEntryLine.findMany({
        where: {
          journalEntry: { sourceId: result.matchedFinancialTransactionId! },
        },
      });
      expect(lines).toHaveLength(2);
      const expenseLine = lines.find((l) => l.accountId === expenseAccountId)!;
      expect(Number(expenseLine.debit)).toBe(1000);
      expect(Number(expenseLine.credit)).toBe(0);
      const bankLine = lines.find((l) => l.accountId === bankChartAccountId)!;
      expect(Number(bankLine.credit)).toBe(1000);
      expect(Number(bankLine.debit)).toBe(0);
    });

    it('rejects classifying as EXPENSE without an expense account (invalid master-data reference)', async () => {
      const txn = await importOutgoing({ amount: -100 });
      await expect(
        reconciliation.classifyOutgoing(txn.id, { outgoingType: 'EXPENSE' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects confirming an expense voucher with no expense account classified anywhere', async () => {
      const txn = await importOutgoing({ amount: -100 });
      await expect(
        reconciliation.confirmExpenseVoucher(txn.id, {}, testUserId, {
          companyId: null,
          branchId: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------
  // 6. Bulk operations
  // -------------------------------------------------------------------

  describe('bulk operations', () => {
    it('reports partial success — one bad id never aborts the whole batch', async () => {
      const good = await importOutgoing({
        amount: -150,
        expenseAccountId,
        outgoingType: 'EXPENSE',
      });
      const bad = randomUUID();

      const results = await reconciliation.bulkConfirmExpenseVouchers(
        [good.id, bad],
        testUserId,
        { companyId: null, branchId: null },
      );

      const goodResult = results.find((r) => r.id === good.id);
      const badResult = results.find((r) => r.id === bad);
      expect(goodResult?.success).toBe(true);
      expect(badResult?.success).toBe(false);

      const reconciled = await prisma.bankTransaction.findUniqueOrThrow({
        where: { id: good.id },
      });
      expect(reconciled.matchedFinancialTransactionId).toBeTruthy();
    });
  });
});
