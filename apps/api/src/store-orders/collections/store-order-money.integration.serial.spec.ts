import { Test, type TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AccountType,
  FinancialTransactionStatus,
  InventoryMovementType,
  JournalEntryStatus,
  PartnerRoleType,
  PaymentOrigin,
  PaymentSettlementStatus,
  PaymentStatus,
  Prisma,
  ReturnItemCondition,
  StoreOrderPaymentStatus,
  StoreOrderPaymentType,
  StoreOrderRecognitionStatus,
} from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { FxModule } from '../../accounting/fx/fx.module';
import { PostingProvidersModule } from '../../accounting/posting-providers/posting-providers.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { InventoryService } from '../../inventory/inventory.service';
import { SalesInvoicesModule } from '../../sales/invoices/sales-invoices.module';
import { SalesInvoicesService } from '../../sales/invoices/sales-invoices.service';
import { SalesReturnsModule } from '../../sales/returns/sales-returns.module';
import { PaymentReconciliationModule } from '../../payment-reconciliation/payment-reconciliation.module';
import { PaymentStatementsService } from '../../payment-reconciliation/payment-statements.service';
import { PaymentMatchingService } from '../../payment-reconciliation/payment-matching.service';
import { GoogleSheetsService } from '../../import-center/google-sheets.service';
import { PaymentSettlementsModule } from '../../payment-settlements/payment-settlements.module';
import { PaymentSettlementsService } from '../../payment-settlements/payment-settlements.service';
import { ShippingCompaniesModule } from '../../shipping-companies/shipping-companies.module';
import { ShippingCompaniesService } from '../../shipping-companies/shipping-companies.service';
import { PaymentsService } from '../../payments/payments.service';
import { StoreOrderCollectionService } from '../../accounting/store-order-collection/store-order-collection.service';
import { CarrierCodCollectionService } from '../../accounting/store-order-collection/carrier-cod-collection.service';
import { StoreOrderRefundsService } from '../../financial-transactions/refunds/store-order-refunds.service';
import { loadStoreOrderMoneyPosition } from '../../financial-transactions/shared/store-order-money';
import { StoreOrderPaymentDeclarationService } from '../payment-declaration/store-order-payment-declaration.service';
import { StoreOrderReturnsService } from '../returns/store-order-returns.service';
import { StoreOrderMoneyModule } from './store-order-money.module';
import { StoreOrderMoneyService } from './store-order-money.service';
import { FinancialTransactionsService } from '../../financial-transactions/financial-transactions.service';
import { WorkflowStatusResolverService } from '../../workflow/workflow-status-resolver.service';
import { partnerLedgerBalances } from '../../accounting/reports/partner-ledger-balance';

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(
  process.env.DATABASE_URL ?? '',
);
const describeDb = LOCAL_DB ? describe : describe.skip;

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error: unknown) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse();
    return typeof body === 'string' ? body : (body as { code?: string }).code;
  }
  throw new Error('expected the operation to be rejected');
}

/**
 * R15 W5b (D15-9 … D15-12) — store-order money after the sale against the
 * real local Postgres (`oms_r15_w5b`): collection timing (declaration never
 * posts, receipts allocate oldest-first across one invoice per delivered
 * shipment), carrier COD (expected claim → statement match → settlement, cash
 * once), returns (request → receive & inspect → credit note), refunds
 * (credit notes, cancelled-order advance, overpayment; exactly-once under
 * concurrency) and the audited reversal of an erroneous payment. Delivery is
 * driven the way recognition issues it (a confirmed invoice linked to the
 * order + delivered shipment, then `syncVerifiedPayments`), so the suite does
 * not depend on the shipment pipeline. Tagged fixtures (W5B-<tag>) are kept.
 */
describeDb(
  'Store order money: collections, returns, refunds, reversal (integration)',
  () => {
    jest.setTimeout(600_000);
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let inventory: InventoryService;
    let invoices: SalesInvoicesService;
    let declarations: StoreOrderPaymentDeclarationService;
    let payments: PaymentsService;
    let collection: StoreOrderCollectionService;
    let carrierCod: CarrierCodCollectionService;
    let refunds: StoreOrderRefundsService;
    let returns: StoreOrderReturnsService;
    let money: StoreOrderMoneyService;
    let statements: PaymentStatementsService;
    let matching: PaymentMatchingService;
    let settlements: PaymentSettlementsService;
    let carriers: ShippingCompaniesService;
    let financialTransactions: FinancialTransactionsService;
    let statusResolver: WorkflowStatusResolverService;

    const tag = randomUUID().slice(0, 8).toUpperCase();
    let seq = 0;
    let actorId: string;
    let unitId: string;
    let warehouseId: string;
    let damagedWarehouseId: string;
    let customerId: string;
    let currencyId: string;
    let bankAccountId: string;
    let bankReceivingAccountId: string;
    let bankMethodId: string;
    let clearingAccountId: string;
    let codMethodId: string;
    let codCarrierId: string;
    let untrackedCarrierId: string;
    let productId: string;
    let inventoryAccountId: string;
    let cogsAccountId: string;
    const today = () => new Date().toISOString().slice(0, 10);
    const context = { companyId: null, branchId: null };

    const makeOrder = async (
      lines: { quantity: number; amount: number }[],
      paymentType: StoreOrderPaymentType,
      agentId: string | null = null,
    ) =>
      prisma.storeOrder.create({
        data: {
          internalOrderId: `W5B-${tag}-${++seq}`,
          partnerId: customerId,
          currencyId,
          paymentType,
          agentId,
          items: {
            create: lines.map((line) => ({
              productId,
              quantity: line.quantity,
              unitPrice: line.amount / line.quantity,
              agreedAmount: line.amount,
            })),
          },
        },
        include: { items: true },
      });

    const declare = async (
      storeOrderId: string,
      kind: 'FULL' | 'PARTIAL',
      amount?: number,
    ) => {
      const result = await declarations.declare(
        storeOrderId,
        {
          kind,
          amount,
          paymentMethodId: bankMethodId,
          currencyId,
          paymentDate: today(),
        },
        randomUUID(),
        // A declaration after delivery is a correction (store-orders.manage).
        {
          userId: actorId,
          origin: PaymentOrigin.SALES_DECLARATION,
          allowCorrection: true,
        },
      );
      return result.payment!;
    };

    /** A shipment attempt the carrier delivered (no invoice yet). */
    const shipDelivered = (
      order: Awaited<ReturnType<typeof makeOrder>>,
      quantities: number[],
      shippingCompanyId: string | null = null,
    ) =>
      prisma.shipment.create({
        data: {
          storeOrderId: order.id,
          attemptNumber: ++seq,
          status: 'DELIVERED',
          shippingCompanyId,
          trackingNumber: `TRK-W5B-${tag}-${seq}`,
          lines: {
            create: order.items
              .map((item, index) => ({
                item,
                quantity: quantities[index] ?? 0,
              }))
              .filter((row) => row.quantity > 0)
              .map((row) => ({
                storeOrderItemId: row.item.id,
                quantity: row.quantity,
                deliveredQuantity: row.quantity,
              })),
          },
        },
      });

    /**
     * One delivered shipment exactly as recognition issues it (R15: one invoice
     * per delivered shipment): the shipment, its invoice for the delivered
     * quantities (stock + revenue + COGS posted on confirm) and the order's
     * advances allocated to it.
     */
    const deliver = async (
      order: Awaited<ReturnType<typeof makeOrder>>,
      quantities: number[],
      opts: {
        shippingCompanyId?: string | null;
        taxId?: string;
        /** Invoice an attempt already marked delivered (recognition retried). */
        shipmentId?: string;
      } = {},
    ) => {
      const shipment = opts.shipmentId
        ? await prisma.shipment.findUniqueOrThrow({
            where: { id: opts.shipmentId },
          })
        : await shipDelivered(order, quantities, opts.shippingCompanyId);
      const draft = await invoices.create({
        partnerId: order.partnerId,
        currencyId,
        items: order.items
          .map((item, index) => ({ item, quantity: quantities[index] ?? 0 }))
          .filter((row) => row.quantity > 0)
          .map((row) => ({
            productId,
            warehouseId,
            unitId,
            quantity: row.quantity,
            unitPrice: Number(row.item.agreedAmount) / row.item.quantity,
            taxId: opts.taxId,
          })),
      });
      await prisma.salesInvoice.update({
        where: { id: draft.id },
        data: { storeOrderId: order.id, shipmentId: shipment.id },
      });
      const invoice = await invoices.confirm(draft.id, actorId);
      await prisma.storeOrder.update({
        where: { id: order.id },
        data: { recognitionStatus: StoreOrderRecognitionStatus.RECOGNIZED },
      });
      await collection.syncVerifiedPayments(order.id, actorId);
      return { shipment, invoice };
    };

    const allocatedTo = async (salesInvoiceId: string) =>
      Number(
        (
          await prisma.financialTransactionAllocation.aggregate({
            where: {
              salesInvoiceId,
              transaction: { status: FinancialTransactionStatus.CONFIRMED },
            },
            _sum: { allocatedAmount: true },
          })
        )._sum.allocatedAmount ?? 0,
      );

    /**
     * Each scenario gets its own customer: refunds are also capped by the
     * customer's credit on the posted AR ledger, which spans all their orders.
     */
    const newCustomer = async () => {
      customerId = (
        await prisma.partner.create({
          data: {
            partnerNumber: `PT-W5B-${tag}-${++seq}`,
            name: `W5b customer ${tag} ${seq}`,
            roles: { create: { role: PartnerRoleType.CUSTOMER } },
          },
        })
      ).id;
    };

    /** The customer's AR on the posted ledger (debit − credit of the receivable control accounts). */
    const ledgerAr = async (partnerId: string) =>
      Math.round(
        ((await partnerLedgerBalances(prisma, [partnerId])).get(partnerId)
          ?.receivable ?? 0) * 100,
      ) / 100;

    /**
     * The same balance from the documents' open amounts (customers without
     * returns here): open invoices − receipts' unallocated money. Equal to the
     * ledger only when refunded money is no longer unallocated on a receipt.
     */
    const openDocuments = async (partnerId: string) => {
      const [salesInvoices, receipts] = await Promise.all([
        prisma.salesInvoice.findMany({
          where: {
            partnerId,
            deletedAt: null,
            status: { in: ['CONFIRMED', 'CLOSED'] },
          },
          select: { id: true, grandTotal: true },
        }),
        prisma.financialTransaction.findMany({
          where: {
            partnerId,
            type: 'CUSTOMER_RECEIPT',
            status: FinancialTransactionStatus.CONFIRMED,
            deletedAt: null,
          },
          select: {
            amount: true,
            feeAmount: true,
            allocations: { select: { allocatedAmount: true } },
          },
        }),
      ]);
      let open = 0;
      for (const invoice of salesInvoices) {
        open += Number(invoice.grandTotal) - (await allocatedTo(invoice.id));
      }
      for (const receipt of receipts) {
        open -=
          Number(receipt.amount) +
          Number(receipt.feeAmount ?? 0) -
          receipt.allocations.reduce(
            (sum, row) => sum + Number(row.allocatedAmount),
            0,
          );
      }
      return Math.round(open * 100) / 100;
    };

    /** What a receipt still offers for allocation (amount + fee − Σ allocations). */
    const unallocatedOf = async (receiptId: string) => {
      const receipt = await prisma.financialTransaction.findUniqueOrThrow({
        where: { id: receiptId },
        select: {
          amount: true,
          feeAmount: true,
          allocations: { select: { allocatedAmount: true } },
        },
      });
      return (
        Math.round(
          (Number(receipt.amount) +
            Number(receipt.feeAmount ?? 0) -
            receipt.allocations.reduce(
              (sum, row) => sum + Number(row.allocatedAmount),
              0,
            )) *
            100,
        ) / 100
      );
    };

    const position = async (storeOrderId: string) =>
      (await loadStoreOrderMoneyPosition(prisma, storeOrderId))!;

    const receiptOf = async (paymentId: string) =>
      prisma.paymentReceiptLink.findUnique({
        where: { paymentId },
        include: { financialTransaction: { include: { allocations: true } } },
      });

    /** The posted, non-reversal entries of a source document (each one balanced). */
    const journals = async (sourceType: string, sourceId: string) => {
      const entries = await prisma.journalEntry.findMany({
        where: {
          sourceType,
          sourceId,
          status: JournalEntryStatus.POSTED,
        },
        include: { lines: true },
        orderBy: { createdAt: 'asc' },
      });
      for (const entry of entries) {
        const debit = entry.lines.reduce(
          (sum, line) => sum.add(line.debit),
          D(0),
        );
        const credit = entry.lines.reduce(
          (sum, line) => sum.add(line.credit),
          D(0),
        );
        expect(debit.equals(credit)).toBe(true);
      }
      return entries;
    };
    const side = (
      entry: {
        lines: {
          accountId: string;
          debit: Prisma.Decimal;
          credit: Prisma.Decimal;
        }[];
      },
      accountId: string,
      which: 'debit' | 'credit',
    ) =>
      entry.lines
        .filter((line) => line.accountId === accountId)
        .reduce((sum, line) => sum + Number(line[which]), 0);

    const onHand = async (warehouse: string) =>
      (await inventory.getStock(productId, warehouse)).onHand;

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [
          PrismaModule,
          PermissionsCoreModule,
          PhoneModule,
          AuthModule,
          FxModule,
          PostingProvidersModule,
          InventoryModule,
          SalesInvoicesModule,
          SalesReturnsModule,
          PaymentReconciliationModule,
          PaymentSettlementsModule,
          ShippingCompaniesModule,
          StoreOrderMoneyModule,
        ],
      })
        .overrideProvider(GoogleSheetsService)
        .useValue({})
        .compile();
      await moduleRef.init();
      const get = <T>(type: new (...args: never[]) => T) =>
        moduleRef.get(type, { strict: false });
      prisma = get(PrismaService);
      inventory = get(InventoryService);
      invoices = get(SalesInvoicesService);
      declarations = get(StoreOrderPaymentDeclarationService);
      payments = get(PaymentsService);
      collection = get(StoreOrderCollectionService);
      carrierCod = get(CarrierCodCollectionService);
      refunds = get(StoreOrderRefundsService);
      returns = get(StoreOrderReturnsService);
      money = get(StoreOrderMoneyService);
      statements = get(PaymentStatementsService);
      matching = get(PaymentMatchingService);
      settlements = get(PaymentSettlementsService);
      carriers = get(ShippingCompaniesService);
      financialTransactions = get(FinancialTransactionsService);
      statusResolver = get(WorkflowStatusResolverService);

      const lower = tag.toLowerCase();
      actorId = (
        await prisma.user.create({
          data: {
            email: `w5b-${lower}@test.local`,
            username: `w5b-${lower}`,
            fullName: `R15 W5b ${tag}`,
            passwordHash: 'x',
            isSuperAdmin: true,
          },
        })
      ).id;
      unitId = (await prisma.unit.create({ data: { name: `w5b-${tag}-pc` } }))
        .id;
      warehouseId = (
        await prisma.warehouse.create({
          data: { code: `W5B-${tag}`, name: `W5b stock ${tag}` },
        })
      ).id;
      damagedWarehouseId = (
        await prisma.warehouse.findFirstOrThrow({
          where: { code: 'WH-DAMAGED', role: 'DAMAGED' },
          select: { id: true },
        })
      ).id;
      currencyId = (await prisma.postingSettings.findFirstOrThrow())
        .functionalCurrencyId!;
      const account = async (kind: string, accountType: AccountType) =>
        (
          await prisma.chartOfAccount.create({
            data: {
              code: `W5B-${tag}-${kind}`,
              name: `W5b ${kind} ${tag}`,
              accountType,
            },
          })
        ).id;
      bankAccountId = await account('BANK', AccountType.ASSET);
      clearingAccountId = await account('COD-CLR', AccountType.ASSET);
      inventoryAccountId = await account('INV', AccountType.ASSET);
      cogsAccountId = await account('COGS', AccountType.EXPENSE);
      bankReceivingAccountId = (
        await prisma.receivingAccount.create({
          data: {
            name: `W5b bank ${tag}`,
            code: `W5B-RA-${tag}`,
            chartOfAccountId: bankAccountId,
          },
        })
      ).id;
      // A direct bank transfer: Finance verifies it from review (no statement).
      bankMethodId = (
        await prisma.paymentMethod.create({
          data: {
            name: `W5b transfer ${tag}`,
            accountId: bankAccountId,
            requiresReconciliation: false,
          },
        })
      ).id;
      // The carrier's COD collections: its report is the statement, its remittance the settlement.
      codMethodId = (
        await prisma.paymentMethod.create({
          data: {
            name: `W5b carrier COD ${tag}`,
            accountId: clearingAccountId,
            requiresReconciliation: true,
          },
        })
      ).id;
      codCarrierId = (
        await carriers.create(
          { name: `W5b carrier ${tag}`, codPaymentMethodId: codMethodId },
          actorId,
        )
      ).id;
      untrackedCarrierId = (
        await carriers.create({ name: `W5b courier ${tag}` }, actorId)
      ).id;
      const category = await prisma.productCategory.create({
        data: {
          name: `w5b-${tag}`,
          inventoryAccountId,
          cogsAccountId,
        },
      });
      productId = (
        await prisma.product.create({
          data: {
            sku: `W5B-${tag}`,
            name: `W5b product ${tag}`,
            internalName: `W5b product ${tag}`,
            displayName: `W5b product ${tag}`,
            categoryId: category.id,
            unitId,
            preferredWarehouseId: warehouseId,
            type: 'PURCHASE_AND_SALE',
            itemType: 'PRODUCT',
            supplyMethod: 'PURCHASED',
            isPurchasable: true,
            isSellable: true,
            isInventoryItem: true,
            currentCost: 40,
          },
        })
      ).id;
      await inventory.openingBalance({ productId, warehouseId, quantity: 100 });
    });

    afterAll(async () => {
      await moduleRef?.close();
    });

    it('carrier COD method: only a reconciled method with a clearing account', async () => {
      expect(
        await codeOf(
          carriers.create(
            {
              name: `W5b bad carrier ${tag}`,
              codPaymentMethodId: bankMethodId,
            },
            actorId,
          ),
        ),
      ).toBe('COD_PAYMENT_METHOD_INVALID');
      const carrier = await prisma.shippingCompany.findUniqueOrThrow({
        where: { id: codCarrierId },
      });
      expect(carrier.codPaymentMethodId).toBe(codMethodId);
    });

    it('prepaid: declaration never posts; verified = advance; delivery allocates; return requested → received (saleable / damaged) → credit note; refund once', async () => {
      await newCustomer();
      const order = await makeOrder(
        [{ quantity: 2, amount: 200 }],
        StoreOrderPaymentType.PREPAID,
      );
      const claim = await declare(order.id, 'FULL');
      expect(claim.status).toBe(PaymentStatus.PENDING);
      expect(await receiptOf(claim.id)).toBeNull();
      let panel = await money.panel(order.id, actorId);
      expect(panel.figures.declared).toBe(200);
      expect(panel.figures.collected).toBe(0);

      // Finance verifies: Dr bank / Cr AR, an unallocated advance before delivery.
      await payments.confirm(claim.id, actorId);
      const receipt = (await receiptOf(claim.id))!.financialTransaction;
      expect(receipt.allocations).toHaveLength(0);
      const [receiptEntry] = await journals('CUSTOMER_RECEIPT', receipt.id);
      expect(side(receiptEntry, bankAccountId, 'debit')).toBe(200);
      let figures = await position(order.id);
      expect(figures.collected).toBe(200);
      expect(figures.refundDue).toBe(0);
      expect(figures.balanceDue).toBe(0);

      const before = await onHand(warehouseId);
      const { invoice } = await deliver(order, [2]);
      expect(await allocatedTo(invoice.id)).toBe(200);
      expect(await onHand(warehouseId)).toBe(before - 2);
      await prisma.storeOrder.update({
        where: { id: order.id },
        data: { recognitionStatus: StoreOrderRecognitionStatus.RETURN_PENDING },
      });

      // Return requested: a DRAFT credit note, no stock, no posting.
      const invoiceLine = await prisma.salesInvoiceItem.findFirstOrThrow({
        where: { salesInvoiceId: invoice.id },
      });
      const key = randomUUID();
      const requested = await returns.request(
        order.id,
        {
          reason: 'Customer changed mind',
          lines: [{ salesInvoiceItemId: invoiceLine.id, quantity: 1 }],
          idempotencyKey: key,
        },
        actorId,
      );
      expect(requested.returns).toHaveLength(1);
      const [first] = requested.returns;
      expect(first.status).toBe('DRAFT');
      expect(first.reason).toBe('Customer changed mind');
      expect(await onHand(warehouseId)).toBe(before - 2);
      expect(await journals('SALES_RETURN', first.id)).toHaveLength(0);
      const replay = await returns.request(
        order.id,
        {
          reason: 'Customer changed mind',
          lines: [{ salesInvoiceItemId: invoiceLine.id, quantity: 1 }],
          idempotencyKey: key,
        },
        actorId,
      );
      expect(replay.replayed).toBe(true);
      expect(replay.returns.map((row) => row.id)).toEqual([first.id]);
      await expect(
        returns.request(
          order.id,
          {
            reason: 'too many',
            lines: [{ salesInvoiceItemId: invoiceLine.id, quantity: 2 }],
            idempotencyKey: randomUUID(),
          },
          actorId,
        ),
      ).rejects.toThrow(/only 1 remains returnable/);

      // Receive & inspect — saleable back to stock, credit note posted.
      const received = await returns.receive(
        order.id,
        first.id,
        {
          lines: [
            {
              salesReturnItemId: first.items[0].id,
              condition: ReturnItemCondition.SALEABLE,
            },
          ],
        },
        actorId,
      );
      expect(received.status).toBe('CONFIRMED');
      expect(await onHand(warehouseId)).toBe(before - 1);
      const [creditNote] = await journals('SALES_RETURN', first.id);
      expect(side(creditNote, inventoryAccountId, 'debit')).toBe(40);
      expect(side(creditNote, cogsAccountId, 'credit')).toBe(40);
      expect(
        (await prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } }))
          .recognitionStatus,
      ).toBe(StoreOrderRecognitionStatus.PARTIALLY_RETURNED);
      figures = await position(order.id);
      expect(figures.credited).toBe(100);
      expect(figures.refundDue).toBe(100);
      panel = await money.panel(order.id, actorId);
      expect(panel.figures.refundDue).toBe(100);
      expect(panel.figures.refunded).toBe(0); // a credit note alone is not a refund

      // Record refund — money returned outside OMS, Dr AR / Cr bank, once.
      const refundKey = randomUUID();
      const refund = await refunds.record(
        order.id,
        {
          amount: 100,
          receivingAccountId: bankReceivingAccountId,
          referenceNumber: `BANK-${tag}`,
          idempotencyKey: refundKey,
        },
        actorId,
        context,
      );
      expect(refund.status).toBe(FinancialTransactionStatus.CONFIRMED);
      expect(refund.allocations.map((line) => line.salesReturnId)).toEqual([
        first.id,
      ]);
      const [refundEntry] = await journals('CUSTOMER_REFUND', refund.id);
      expect(side(refundEntry, bankAccountId, 'credit')).toBe(100);
      figures = await position(order.id);
      expect(figures.refunded).toBe(100);
      expect(figures.refundDue).toBe(0);
      const again = await refunds.record(
        order.id,
        {
          amount: 100,
          receivingAccountId: bankReceivingAccountId,
          idempotencyKey: refundKey,
        },
        actorId,
        context,
      );
      expect(again.id).toBe(refund.id);
      expect(
        await codeOf(
          refunds.record(
            order.id,
            {
              amount: 1,
              receivingAccountId: bankReceivingAccountId,
              idempotencyKey: randomUUID(),
            },
            actorId,
            context,
          ),
        ),
      ).toBe('REFUND_EXCEEDS_DUE');

      // The second unit comes back damaged → the damaged-goods warehouse.
      const damagedBefore = await onHand(damagedWarehouseId);
      const second = await returns.request(
        order.id,
        {
          reason: 'Broken in transit',
          lines: [{ salesInvoiceItemId: invoiceLine.id, quantity: 1 }],
          idempotencyKey: randomUUID(),
        },
        actorId,
      );
      const damagedReturn = await returns.receive(
        order.id,
        second.returns[0].id,
        {
          lines: [
            {
              salesReturnItemId: second.returns[0].items[0].id,
              condition: ReturnItemCondition.DAMAGED,
            },
          ],
        },
        actorId,
      );
      expect(damagedReturn.items[0].warehouse.id).toBe(damagedWarehouseId);
      expect(await onHand(damagedWarehouseId)).toBe(damagedBefore + 1);
      expect(await onHand(warehouseId)).toBe(before - 1);
      const movement = await prisma.inventoryMovement.findFirstOrThrow({
        where: {
          referenceId: damagedReturn.id,
          type: InventoryMovementType.SALES_RETURN,
        },
      });
      expect(movement.warehouseId).toBe(damagedWarehouseId);
      expect(
        (await prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } }))
          .recognitionStatus,
      ).toBe(StoreOrderRecognitionStatus.RETURNED);
      expect((await position(order.id)).refundDue).toBe(100);
    });

    it('allocation across several invoices (one per delivered shipment) is oldest-first and never over-allocates', async () => {
      await newCustomer();
      // Advance first, then two deliveries.
      const prepaid = await makeOrder(
        [{ quantity: 3, amount: 300 }],
        StoreOrderPaymentType.PREPAID,
      );
      await payments.confirm((await declare(prepaid.id, 'FULL')).id, actorId);
      const one = await deliver(prepaid, [1]);
      expect(await allocatedTo(one.invoice.id)).toBe(100);
      const two = await deliver(prepaid, [2]);
      expect(await allocatedTo(two.invoice.id)).toBe(200);

      // Two deliveries first, then a partial payment.
      const cod = await makeOrder(
        [{ quantity: 3, amount: 300 }],
        StoreOrderPaymentType.CASH_ON_DELIVERY,
      );
      const a = await deliver(cod, [1]);
      const b = await deliver(cod, [2]);
      await payments.confirm(
        (await declare(cod.id, 'PARTIAL', 250)).id,
        actorId,
      );
      expect(await allocatedTo(a.invoice.id)).toBe(100);
      expect(await allocatedTo(b.invoice.id)).toBe(150);
      expect((await position(cod.id)).balanceDue).toBe(50);
    });

    it('cancelled prepaid order: the advance is refunded against the order, exactly once under concurrency; its payment can no longer be reversed', async () => {
      await newCustomer();
      const order = await makeOrder(
        [{ quantity: 1, amount: 150 }],
        StoreOrderPaymentType.PREPAID,
      );
      const claim = await declare(order.id, 'FULL');
      await payments.confirm(claim.id, actorId);
      await prisma.storeOrder.update({
        where: { id: order.id },
        data: { deletedAt: new Date() },
      });
      const before = await position(order.id);
      expect(before.active).toBe(false);
      expect(before.refundDue).toBe(150);
      expect(before.advanceRefundable).toBe(150);

      const attempt = () =>
        refunds.record(
          order.id,
          {
            amount: 150,
            receivingAccountId: bankReceivingAccountId,
            idempotencyKey: randomUUID(),
          },
          actorId,
          context,
        );
      const results = await Promise.allSettled([attempt(), attempt()]);
      const fulfilled = results.filter((row) => row.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);
      const refund = fulfilled[0].value;
      expect(refund.allocations.map((line) => line.storeOrderId)).toEqual([
        order.id,
      ]);
      const [entry] = await journals('CUSTOMER_REFUND', refund.id);
      expect(side(entry, bankAccountId, 'credit')).toBe(150);
      expect(
        await prisma.financialTransactionAllocation.count({
          where: {
            storeOrderId: order.id,
            transaction: {
              type: 'CUSTOMER_REFUND',
              status: FinancialTransactionStatus.CONFIRMED,
            },
          },
        }),
      ).toBe(1);
      expect((await position(order.id)).refundDue).toBe(0);
      // The receipt carries the refunded advance once (no money left to allocate).
      const receipt = (await receiptOf(claim.id))!.financialTransaction;
      expect(await unallocatedOf(receipt.id)).toBe(0);

      expect(
        await codeOf(payments.reverse(claim.id, 'Recorded twice', actorId)),
      ).toBe('PAYMENT_ALREADY_REFUNDED');
    });

    it('overpayment (order reduced after payment) is refunded against the order and never allocated again', async () => {
      await newCustomer();
      const order = await makeOrder(
        [{ quantity: 2, amount: 200 }],
        StoreOrderPaymentType.PREPAID,
      );
      await payments.confirm((await declare(order.id, 'FULL')).id, actorId);
      // An amendment lowered the agreed amount after the payment was verified.
      const reduced = await prisma.storeOrder.update({
        where: { id: order.id },
        data: {
          items: {
            update: {
              where: { id: order.items[0].id },
              data: { agreedAmount: 150, unitPrice: 75 },
            },
          },
        },
        include: { items: true },
      });
      const { invoice } = await deliver(reduced, [2]);
      expect(await allocatedTo(invoice.id)).toBe(150);
      const figures = await position(order.id);
      expect(figures.refundDue).toBe(50);
      expect(figures.advanceRefundable).toBe(50);
      expect(
        await codeOf(
          refunds.record(
            order.id,
            {
              amount: 50.01,
              receivingAccountId: bankReceivingAccountId,
              idempotencyKey: randomUUID(),
            },
            actorId,
            context,
          ),
        ),
      ).toBe('REFUND_EXCEEDS_DUE');
      const refund = await refunds.record(
        order.id,
        {
          amount: 50,
          receivingAccountId: bankReceivingAccountId,
          idempotencyKey: randomUUID(),
        },
        actorId,
        context,
      );
      expect(refund.allocations[0].storeOrderId).toBe(order.id);
      await journals('CUSTOMER_REFUND', refund.id);
      expect((await position(order.id)).refundDue).toBe(0);
      await collection.syncVerifiedPayments(order.id, actorId);
      expect(await allocatedTo(invoice.id)).toBe(150);
    });

    it('COD via carrier: delivery records an expected claim (no cash); the COD report posts Dr clearing / Cr AR; the remittance settles to the bank — cash once', async () => {
      await newCustomer();
      const order = await makeOrder(
        [{ quantity: 1, amount: 120 }],
        StoreOrderPaymentType.CASH_ON_DELIVERY,
      );
      const { shipment, invoice } = await deliver(order, [1], {
        shippingCompanyId: codCarrierId,
      });
      // Recognition's collection sync recorded the claim with the invoice; the
      // delivery hook that follows finds it (one claim per shipment).
      const again = await carrierCod.onCodShipmentDelivered(
        shipment.id,
        actorId,
      );
      expect(again).toMatchObject({ status: 'EXISTS', amount: 120 });
      const claims = await prisma.payment.findMany({
        where: { storeOrderId: order.id, origin: PaymentOrigin.CARRIER_COD },
      });
      expect(claims).toHaveLength(1);
      const paymentId = claims[0].id;
      const expected = await prisma.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      expect(expected.status).toBe(PaymentStatus.PENDING);
      expect(expected.origin).toBe(PaymentOrigin.CARRIER_COD);
      expect(expected.paymentMethodId).toBe(codMethodId);
      expect(await receiptOf(paymentId)).toBeNull();
      let panel = await money.panel(order.id, actorId);
      expect(panel.codCollection.tracking).toBe('TRACKED');
      expect(panel.figures.expectedFromCarrier).toBe(120);
      expect(panel.figures.collected).toBe(0);
      expect(panel.figures.balanceDue).toBe(120);

      // The carrier's COD report (a manual statement line) is matched → posted.
      await statements.createManualLine(
        codMethodId,
        {
          providerReference: `COD-${tag}`,
          orderReference: order.internalOrderId,
          amount: 120,
          currencyId,
          transactionDate: today(),
        },
        actorId,
      );
      const line = await prisma.paymentStatementLine.findFirstOrThrow({
        where: {
          paymentMethodId: codMethodId,
          providerReference: `COD-${tag}`,
        },
      });
      await matching.confirm(
        codMethodId,
        {
          statementLineId: line.id,
          allocations: [{ paymentId, amount: 120 }],
          idempotencyKey: randomUUID(),
        },
        actorId,
      );
      const verified = await prisma.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      expect(verified.status).toBe(PaymentStatus.VERIFIED);
      expect(verified.settlementStatus).toBe(
        PaymentSettlementStatus.AWAITING_SETTLEMENT,
      );
      const receipt = (await receiptOf(paymentId))!.financialTransaction;
      const [receiptEntry] = await journals('CUSTOMER_RECEIPT', receipt.id);
      expect(side(receiptEntry, clearingAccountId, 'debit')).toBe(120);
      expect(side(receiptEntry, bankAccountId, 'debit')).toBe(0);
      expect(
        receiptEntry.lines.some(
          (row) => row.partnerId === customerId && Number(row.credit) === 120,
        ),
      ).toBe(true);
      expect(await allocatedTo(invoice.id)).toBe(120);
      panel = await money.panel(order.id, actorId);
      expect(panel.figures.withCarrier).toBe(120);
      expect(panel.figures.inBank).toBe(0);
      expect(panel.figures.balanceDue).toBe(0);

      // The carrier remits: Dr bank / Cr clearing.
      const settlement = await settlements.create(
        {
          paymentMethodId: codMethodId,
          claims: [{ paymentId }],
          receivedAmount: 120,
          receivedCurrencyId: currencyId,
          receivingAccountId: bankReceivingAccountId,
          settlementDate: today(),
          idempotencyKey: randomUUID(),
        },
        actorId,
      );
      const [settlementEntry] = await journals(
        'PAYMENT_SETTLEMENT',
        settlement.id,
      );
      expect(side(settlementEntry, bankAccountId, 'debit')).toBe(120);
      expect(side(settlementEntry, clearingAccountId, 'credit')).toBe(120);
      const bankDebits = [receiptEntry, settlementEntry].reduce(
        (sum, entry) => sum + side(entry, bankAccountId, 'debit'),
        0,
      );
      expect(bankDebits).toBe(120); // the cash is recognised once
      panel = await money.panel(order.id, actorId);
      expect(panel.figures.withCarrier).toBe(0);
      expect(panel.figures.inBank).toBe(120);
      expect(panel.payments[0].reverseBlock).toBe('SETTLED');

      expect(
        await codeOf(payments.reverse(paymentId, 'Wrong parcel', actorId)),
      ).toBe('PAYMENT_IN_SETTLEMENT');
    });

    it('COD: a carrier without a COD method is not tracked; an undelivered COD order has nothing to refund', async () => {
      await newCustomer();
      const order = await makeOrder(
        [{ quantity: 1, amount: 80 }],
        StoreOrderPaymentType.CASH_ON_DELIVERY,
      );
      const { shipment } = await deliver(order, [1], {
        shippingCompanyId: untrackedCarrierId,
      });
      expect(
        await carrierCod.recordExpectedCollection(shipment.id, actorId),
      ).toMatchObject({ status: 'NOT_TRACKED' });
      const panel = await money.panel(order.id, actorId);
      expect(panel.codCollection.tracking).toBe('NOT_TRACKED');
      expect(panel.figures.expectedFromCarrier).toBe(0);

      const returned = await makeOrder(
        [{ quantity: 1, amount: 80 }],
        StoreOrderPaymentType.CASH_ON_DELIVERY,
      );
      const attempt = await prisma.shipment.create({
        data: {
          storeOrderId: returned.id,
          attemptNumber: 1,
          status: 'RETURN_BEFORE_DELIVERY',
          shippingCompanyId: codCarrierId,
        },
      });
      expect(
        await carrierCod.recordExpectedCollection(attempt.id, actorId),
      ).toMatchObject({ status: 'NOT_APPLICABLE', reason: 'NOT_DELIVERED' });
      expect((await position(returned.id)).refundDue).toBe(0);
      expect(
        await codeOf(
          refunds.record(
            returned.id,
            {
              amount: 80,
              receivingAccountId: bankReceivingAccountId,
              idempotencyKey: randomUUID(),
            },
            actorId,
            context,
          ),
        ),
      ).toBe('REFUND_EXCEEDS_DUE');
    });

    it('reversal of a payment verified in error (Finance review): reversing entry, REVERSED with audit, invoice reopened, order status recomputed — never deleted', async () => {
      await newCustomer();
      const order = await makeOrder(
        [{ quantity: 2, amount: 100 }],
        StoreOrderPaymentType.PREPAID,
      );
      const claim = await declare(order.id, 'FULL');
      await payments.confirm(claim.id, actorId);
      const { invoice } = await deliver(order, [2]);
      expect(await allocatedTo(invoice.id)).toBe(100);
      const receipt = (await receiptOf(claim.id))!.financialTransaction;
      const [original] = await journals('CUSTOMER_RECEIPT', receipt.id);
      let panel = await money.panel(order.id, actorId);
      expect(panel.payments[0].reverseBlock).toBeNull();

      await expect(payments.reverse(claim.id, '  ', actorId)).rejects.toThrow(
        /reason is required/,
      );
      const reversed = await payments.reverse(
        claim.id,
        'Bank transfer recorded twice',
        actorId,
      );
      expect(reversed.status).toBe(PaymentStatus.REVERSED);
      expect(reversed.reversalReason).toBe('Bank transfer recorded twice');
      expect(reversed.reversedById).toBe(actorId);
      expect(reversed.reversedAt).not.toBeNull();
      const cancelled = await prisma.financialTransaction.findUniqueOrThrow({
        where: { id: receipt.id },
      });
      expect(cancelled.status).toBe(FinancialTransactionStatus.CANCELLED);
      expect(cancelled.deletedAt).toBeNull();
      const reversal = await prisma.journalEntry.findFirstOrThrow({
        where: { reversalOfEntryId: original.id },
        include: { lines: true },
      });
      expect(side(reversal, bankAccountId, 'credit')).toBe(100);
      expect(await allocatedTo(invoice.id)).toBe(0);
      const after = await prisma.storeOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(after.paymentStatus).toBe(StoreOrderPaymentStatus.PAYMENT_PENDING);
      expect((await position(order.id)).balanceDue).toBe(100);
      expect(
        await prisma.paymentActivity.count({
          where: { paymentId: claim.id, type: 'REVERSED' },
        }),
      ).toBe(1);
      expect(
        await prisma.storeOrderActivity.count({
          where: { storeOrderId: order.id, action: 'PAYMENT_REVERSED' },
        }),
      ).toBe(1);
      panel = await money.panel(order.id, actorId);
      expect(panel.payments[0].status).toBe(PaymentStatus.REVERSED);

      // A retry changes nothing; a reversed payment is never confirmed again.
      await payments.reverse(claim.id, 'Bank transfer recorded twice', actorId);
      expect(
        await prisma.journalEntry.count({
          where: { reversalOfEntryId: original.id },
        }),
      ).toBe(1);
      await expect(payments.confirm(claim.id, actorId)).rejects.toThrow(
        /reversed as recorded in error/,
      );
    });

    it('H1: a refunded order advance leaves its receipt — never allocated again (generic Allocate, automatic sync); ledger AR = open documents; cancelling the refund gives it back', async () => {
      await newCustomer();
      const cancelled = await makeOrder(
        [{ quantity: 1, amount: 150 }],
        StoreOrderPaymentType.PREPAID,
      );
      const claim = await declare(cancelled.id, 'FULL');
      await payments.confirm(claim.id, actorId);
      const receipt = (await receiptOf(claim.id))!.financialTransaction;
      await prisma.storeOrder.update({
        where: { id: cancelled.id },
        data: { deletedAt: new Date() },
      });
      const refund = await refunds.record(
        cancelled.id,
        {
          amount: 150,
          receivingAccountId: bankReceivingAccountId,
          idempotencyKey: randomUUID(),
        },
        actorId,
        context,
      );
      expect(await unallocatedOf(receipt.id)).toBe(0);

      // Another order of the same customer owes 100 (COD, delivered).
      const owing = await makeOrder(
        [{ quantity: 1, amount: 100 }],
        StoreOrderPaymentType.CASH_ON_DELIVERY,
      );
      const { invoice } = await deliver(owing, [1]);
      await expect(
        financialTransactions.allocate(
          receipt.id,
          { invoiceId: invoice.id, allocatedAmount: 100 },
          actorId,
        ),
      ).rejects.toThrow(/remains unallocated/);
      await collection.syncVerifiedPayments(cancelled.id, actorId);
      await collection.syncVerifiedPayments(owing.id, actorId);
      expect(await allocatedTo(invoice.id)).toBe(0);
      expect((await position(owing.id)).balanceDue).toBe(100);
      expect(await ledgerAr(customerId)).toBe(100);
      expect(await openDocuments(customerId)).toBe(100);

      // The refunded part is not a matching choice; the receipt cannot be
      // reversed while the refund stands.
      const held = await prisma.financialTransactionAllocation.findFirstOrThrow(
        {
          where: { transactionId: receipt.id, storeOrderId: cancelled.id },
        },
      );
      expect(Number(held.allocatedAmount)).toBe(150);
      expect(
        await codeOf(financialTransactions.unallocate(receipt.id, held.id)),
      ).toBe('ADVANCE_REFUND_ALLOCATION');

      // Cancelling the refund gives the money back to the receipt.
      await financialTransactions.cancel(refund.id, actorId);
      expect(await unallocatedOf(receipt.id)).toBe(150);
      expect((await position(cancelled.id)).refundDue).toBe(150);
      expect(await ledgerAr(customerId)).toBe(-50);
      expect(await openDocuments(customerId)).toBe(-50);
    });

    it("H1: an order's \"collected\" is where its receipts' money was applied — an advance applied to another order's invoice is that order's collection, never refundable on its own order", async () => {
      await newCustomer();
      const advance = await makeOrder(
        [{ quantity: 1, amount: 100 }],
        StoreOrderPaymentType.PREPAID,
      );
      const claim = await declare(advance.id, 'FULL');
      await payments.confirm(claim.id, actorId);
      const receipt = (await receiptOf(claim.id))!.financialTransaction;
      const owing = await makeOrder(
        [{ quantity: 1, amount: 100 }],
        StoreOrderPaymentType.CASH_ON_DELIVERY,
      );
      const { invoice } = await deliver(owing, [1]);
      // Finance applies the advance to the other order's invoice (manual matching).
      await financialTransactions.allocate(
        receipt.id,
        { invoiceId: invoice.id, allocatedAmount: 100 },
        actorId,
      );
      expect((await position(owing.id)).collected).toBe(100);
      expect((await position(owing.id)).balanceDue).toBe(0);
      expect((await position(advance.id)).collected).toBe(0);

      await prisma.storeOrder.update({
        where: { id: advance.id },
        data: { deletedAt: new Date() },
      });
      expect((await position(advance.id)).refundDue).toBe(0);
      expect(
        await codeOf(
          refunds.record(
            advance.id,
            {
              amount: 1,
              receivingAccountId: bankReceivingAccountId,
              idempotencyKey: randomUUID(),
            },
            actorId,
            context,
          ),
        ),
      ).toBe('REFUND_EXCEEDS_DUE');
      expect(await ledgerAr(customerId)).toBe(0);
      expect(await openDocuments(customerId)).toBe(0);
    });

    it('M2: a pickup cancelled without archiving is cancelled for money too — its advance is refundable', async () => {
      await newCustomer();
      const order = await makeOrder(
        [{ quantity: 1, amount: 150 }],
        StoreOrderPaymentType.PREPAID,
      );
      await prisma.storeOrder.update({
        where: { id: order.id },
        data: { fulfillmentMethod: 'PICKUP' },
      });
      await payments.confirm((await declare(order.id, 'FULL')).id, actorId);
      expect((await position(order.id)).refundDue).toBe(0);
      await prisma.storeOrder.update({
        where: { id: order.id },
        data: {
          fulfillmentStatusId:
            statusResolver.fulfillmentStatusIdByCode('CANCELLED'),
        },
      });
      const cancelled = await position(order.id);
      expect(cancelled.active).toBe(false);
      expect(cancelled.refundDue).toBe(150);
      expect((await money.panel(order.id, actorId)).cancelled).toBe(true);
      const refund = await refunds.record(
        order.id,
        {
          amount: 150,
          receivingAccountId: bankReceivingAccountId,
          idempotencyKey: randomUUID(),
        },
        actorId,
        context,
      );
      expect(refund.allocations[0].storeOrderId).toBe(order.id);
      expect((await position(order.id)).refundDue).toBe(0);
    });

    it('L8: no COD claim before the invoice exists; once invoiced, the claim is the invoice incl. VAT and can be confirmed', async () => {
      await newCustomer();
      const vatAccount = await prisma.chartOfAccount.create({
        data: {
          code: `W5B-${tag}-VAT`,
          name: `W5b VAT ${tag}`,
          accountType: AccountType.LIABILITY,
        },
      });
      const vat = await prisma.tax.create({
        data: {
          code: `W5B-VAT-${tag}`,
          name: `W5b VAT 14 ${tag}`,
          rate: 14,
          inclusive: false,
          outputAccountId: vatAccount.id,
        },
      });
      const order = await makeOrder(
        [{ quantity: 1, amount: 100 }],
        StoreOrderPaymentType.CASH_ON_DELIVERY,
      );
      const shipment = await shipDelivered(order, [1], codCarrierId);
      // Recognition failed: delivered, not invoiced → nothing guessed.
      expect(
        await carrierCod.recordExpectedCollection(shipment.id, actorId),
      ).toMatchObject({ status: 'AWAITING_INVOICE' });
      expect(
        await prisma.payment.count({ where: { storeOrderId: order.id } }),
      ).toBe(0);

      // The retried recognition issues the invoice (100 + 14 % VAT) and the
      // collection sync records the carrier's expected collection.
      const { invoice } = await deliver(order, [1], {
        shipmentId: shipment.id,
        taxId: vat.id,
      });
      expect(Number(invoice.grandTotal)).toBe(114);
      const expected = await prisma.payment.findFirstOrThrow({
        where: { storeOrderId: order.id, origin: PaymentOrigin.CARRIER_COD },
      });
      expect(Number(expected.amount)).toBe(114);

      await statements.createManualLine(
        codMethodId,
        {
          providerReference: `COD-VAT-${tag}`,
          amount: 114,
          currencyId,
          transactionDate: today(),
        },
        actorId,
      );
      const line = await prisma.paymentStatementLine.findFirstOrThrow({
        where: {
          paymentMethodId: codMethodId,
          providerReference: `COD-VAT-${tag}`,
        },
      });
      await matching.confirm(
        codMethodId,
        {
          statementLineId: line.id,
          allocations: [{ paymentId: expected.id, amount: 114 }],
          idempotencyKey: randomUUID(),
        },
        actorId,
      );
      expect(
        (await prisma.payment.findUniqueOrThrow({ where: { id: expected.id } }))
          .status,
      ).toBe(PaymentStatus.VERIFIED);
      expect(await allocatedTo(invoice.id)).toBe(114);
      expect((await position(order.id)).balanceDue).toBe(0);
    });

    it('agent orders never use the company return / refund flow', async () => {
      await newCustomer();
      const agentPartner = await prisma.partner.create({
        data: { partnerNumber: `PT-W5B-${tag}-AGT`, name: `W5b agent ${tag}` },
      });
      const agent = await prisma.agent.create({
        data: {
          agentNumber: `AG-W5B-${tag}`,
          partnerId: agentPartner.id,
          name: `W5b Agent ${tag}`,
          currencyId,
        },
      });
      const order = await makeOrder(
        [{ quantity: 1, amount: 50 }],
        StoreOrderPaymentType.CASH_ON_DELIVERY,
        agent.id,
      );
      expect(
        await codeOf(
          returns.request(
            order.id,
            {
              reason: 'Agent goods',
              lines: [{ salesInvoiceItemId: randomUUID(), quantity: 1 }],
              idempotencyKey: randomUUID(),
            },
            actorId,
          ),
        ),
      ).toBe('AGENT_ORDER_USE_AGENT_RETURN');
      expect(
        await codeOf(
          refunds.record(
            order.id,
            {
              amount: 10,
              receivingAccountId: bankReceivingAccountId,
              idempotencyKey: randomUUID(),
            },
            actorId,
            context,
          ),
        ),
      ).toBe('AGENT_ORDER_REFUND_NOT_SUPPORTED');
    });
  },
);
