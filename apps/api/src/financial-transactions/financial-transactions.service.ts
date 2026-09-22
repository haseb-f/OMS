import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinancialTransactionStatus,
  FinancialTransactionType,
  PartnerRoleType,
  Prisma,
  SalesDocumentStatus,
  PurchaseDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PartnersService } from '../partners/partners.service';
import {
  FinancialTransactionActivityService,
  FinancialTransactionActivityType,
} from './activities/financial-transaction-activity.service';
import { buildDateRangeFilter } from '../sales/shared/sales-list-query.util';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import type { CompanyContext } from '../common/decorators/current-company-context.decorator';
import {
  computeInvoicePaymentSummary,
  lockInvoiceRow,
  sumConfirmedAllocations,
} from './shared/invoice-payment.util';
import type { AllocationInputDto } from './shared/allocation-input.dto';
import type { FindFinancialTransactionsQueryDto } from './shared/find-financial-transactions-query.dto';
import { prismaEnumFilter } from '../common/query/enum-list';
import { partnerLedgerBalances } from '../accounting/reports/partner-ledger-balance';

type DbClient = Prisma.TransactionClient | PrismaService;

const NUMBERING_DOCUMENT_TYPE: Record<FinancialTransactionType, string> = {
  CUSTOMER_RECEIPT: 'CUSTOMER_RECEIPT',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  EXPENSE_PAYMENT: 'EXPENSE_PAYMENT',
  CUSTOMER_REFUND: 'CUSTOMER_REFUND',
};

/** Sales Return statuses whose credit note is posted — the only ones a Customer Refund may pay back. */
const REFUNDABLE_RETURN_STATUSES: SalesDocumentStatus[] = [
  SalesDocumentStatus.CONFIRMED,
  SalesDocumentStatus.CLOSED,
];

const TRANSACTION_INCLUDE = {
  partner: true,
  expenseAccount: true,
  currency: true,
  paymentSource: true,
  receivingAccount: true,
  allocations: {
    include: {
      salesInvoice: {
        select: { id: true, invoiceNumber: true, grandTotal: true },
      },
      purchaseInvoice: {
        select: { id: true, invoiceNumber: true, grandTotal: true },
      },
      salesReturn: {
        select: { id: true, returnNumber: true, grandTotal: true },
      },
    },
  },
} satisfies Prisma.FinancialTransactionInclude;

export interface FinancialTransactionCreateInput {
  partnerId?: string;
  /** EXPENSE_PAYMENT only — the account debited directly instead of resolving Accounts Payable. */
  expenseAccountId?: string;
  currencyId?: string;
  /** TASK-051 Document Context Enrichment — optional cost attribution, never required. */
  costCenterId?: string;
  projectId?: string;
  transactionDate?: string;
  paymentSourceId?: string;
  receivingAccountId?: string;
  amount: number;
  /**
   * Net-receipt / bank-fee settlement (CUSTOMER_RECEIPT only) — the
   * difference between what actually hit the bank (`amount`) and what the
   * invoice(s) are allocated (`amount + feeAmount`), posted to
   * `feeAccountId` instead of silently inflating the cash receipt. See
   * Part G of the Reconciliation spec.
   */
  feeAmount?: number;
  feeAccountId?: string;
  referenceNumber?: string;
  notes?: string;
  allocations?: AllocationInputDto[];
}

/**
 * What can still be refunded on one posted Sales Return: its unrefunded
 * credit (document currency) capped by the customer's actual credit on the
 * posted ledger — a return that only offset an unpaid invoice leaves no
 * money to give back.
 */
export interface RefundableReturnSummary {
  salesReturnId: string;
  returnNumber: string;
  partnerId: string;
  currencyId: string | null;
  status: SalesDocumentStatus;
  grandTotal: number;
  refundedTotal: number;
  unrefundedCredit: number;
  /** Customer's AR credit on the ledger, expressed in the return's currency (0 when the customer owes us). */
  customerCreditBalance: number;
  refundableAmount: number;
}

export interface OpenInvoiceRow {
  invoiceId: string;
  invoiceNumber: string;
  documentDate: string;
  grandTotal: number;
  allocatedTotal: number;
  remainingBalance: number;
  paymentStatus: ReturnType<
    typeof computeInvoicePaymentSummary
  >['paymentStatus'];
}

/**
 * Financial Transactions & Matching Engine (TASK-043) — the ONE service
 * behind both Customer Receipts and Supplier Payments (`type` is the only
 * thing that varies). Not the Accounting Engine: no journal entries, no GL,
 * no Chart of Accounts logic — this only records settlements and their
 * invoice allocations. Reads/writes SalesInvoice/PurchaseInvoice via raw
 * Prisma (never through SalesInvoicesService/PurchaseInvoicesService) to
 * avoid a cross-module dependency — same pattern SalesReturnsService uses
 * for `assertReturnableQuantity` against SalesInvoiceItem.
 */
@Injectable()
export class FinancialTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partnersService: PartnersService,
    private readonly activityService: FinancialTransactionActivityService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  async create(
    type: FinancialTransactionType,
    dto: FinancialTransactionCreateInput,
    userId?: string,
    context: CompanyContext = { companyId: null, branchId: null },
    /** Joins the caller's transaction (e.g. Payment Confirm & Post) instead of opening its own. */
    outerTx?: Prisma.TransactionClient,
  ) {
    const partyId = await this.assertActiveParty(type, dto);
    const feeAmount = dto.feeAmount ?? 0;
    if (feeAmount > 0) {
      if (type !== 'CUSTOMER_RECEIPT') {
        throw new BadRequestException(
          'A settlement fee can only be recorded on a Customer Receipt.',
        );
      }
      if (!dto.feeAccountId) {
        throw new BadRequestException(
          'feeAccountId is required when feeAmount is set.',
        );
      }
    }
    const allocations = dto.allocations ?? [];
    let currencyId = dto.currencyId;
    if (type === 'CUSTOMER_REFUND') {
      this.assertRefundFullyAllocated(dto.amount, allocations);
      // A refund pays back a credit note in that note's own currency.
      currencyId ??= await this.firstReturnCurrency(allocations, outerTx);
    } else {
      this.assertAllocationsWithinAmount(dto.amount, allocations, feeAmount);
    }
    const resolvedAllocations = await this.resolveAllocations(
      type,
      partyId,
      allocations,
      outerTx,
      currencyId ?? null,
    );

    const transactionNumber = await this.numberingEngine.generateNumber(
      NUMBERING_DOCUMENT_TYPE[type],
      undefined,
      outerTx,
    );

    try {
      return await this.inTransaction(outerTx, async (tx) => {
        const transaction = await tx.financialTransaction.create({
          data: {
            transactionNumber,
            type,
            partnerId: type !== 'EXPENSE_PAYMENT' ? dto.partnerId : undefined,
            expenseAccountId:
              type === 'EXPENSE_PAYMENT' ? dto.expenseAccountId : undefined,
            currencyId,
            companyId: context.companyId ?? undefined,
            branchId: context.branchId ?? undefined,
            costCenterId: dto.costCenterId,
            projectId: dto.projectId,
            transactionDate: dto.transactionDate
              ? new Date(dto.transactionDate)
              : undefined,
            paymentSourceId: dto.paymentSourceId,
            receivingAccountId: dto.receivingAccountId,
            amount: dto.amount,
            feeAmount,
            feeAccountId: feeAmount > 0 ? dto.feeAccountId : undefined,
            referenceNumber: dto.referenceNumber,
            notes: dto.notes,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
            allocations: { create: resolvedAllocations },
          },
          include: TRANSACTION_INCLUDE,
        });
        await this.activityService.log(
          transaction.id,
          FinancialTransactionActivityType.TRANSACTION_CREATED,
          `${this.label(type)} ${transaction.transactionNumber} created`,
          undefined,
          tx,
        );
        return transaction;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Invalid partner, currency, payment source, receiving account, or invoice reference.',
        );
      }
      throw error;
    }
  }

  /** Create + Confirm (+ Posting Engine) atomically — all or nothing. */
  createConfirmed(
    type: FinancialTransactionType,
    dto: FinancialTransactionCreateInput,
    userId?: string,
    context: CompanyContext = { companyId: null, branchId: null },
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const created = await this.create(type, dto, userId, context, tx);
        return this.confirm(created.id, userId, tx);
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  async findAll(
    type: FinancialTransactionType,
    query: FindFinancialTransactionsQueryDto & {
      partnerId?: string | string[];
      /** CUSTOMER_REFUND — only refunds paying back this Sales Return. */
      salesReturnId?: string;
    },
  ) {
    const where: Prisma.FinancialTransactionWhereInput = {
      type,
      deletedAt: null,
      status: prismaEnumFilter(query.status),
      partnerId: prismaEnumFilter(query.partnerId),
      ...(query.salesReturnId
        ? { allocations: { some: { salesReturnId: query.salesReturnId } } }
        : {}),
    };
    if (query.search) {
      where.OR = [
        { transactionNumber: { contains: query.search, mode: 'insensitive' } },
        { referenceNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = buildDateRangeFilter(query.dateFrom, query.dateTo);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.financialTransaction.findMany({
        where,
        include: TRANSACTION_INCLUDE,
        orderBy: { [query.sortBy || 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.financialTransaction.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(type: FinancialTransactionType, id: string) {
    const transaction = await this.prisma.financialTransaction.findFirst({
      where: { id, type, deletedAt: null },
      include: TRANSACTION_INCLUDE,
    });
    if (!transaction) {
      throw new NotFoundException(`${this.label(type)} ${id} not found`);
    }
    return transaction;
  }

  async update(
    id: string,
    dto: Partial<FinancialTransactionCreateInput>,
    userId?: string,
  ) {
    const existing = await this.findOneById(id);
    if (existing.status !== FinancialTransactionStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft ${this.label(existing.type).toLowerCase()} can be edited.`,
      );
    }

    const partyId = existing.partnerId ?? undefined;
    if (dto.amount !== undefined || dto.allocations !== undefined) {
      const amount = dto.amount ?? Number(existing.amount);
      if (existing.type === 'CUSTOMER_REFUND') {
        const lines =
          dto.allocations ??
          (
            await this.prisma.financialTransactionAllocation.findMany({
              where: { transactionId: id },
            })
          ).map((a) => ({
            invoiceId: a.salesReturnId ?? '',
            allocatedAmount: Number(a.allocatedAmount),
          }));
        this.assertRefundFullyAllocated(amount, lines);
      } else {
        this.assertAllocationsWithinAmount(amount, dto.allocations ?? []);
      }
    }

    const resolvedAllocations =
      dto.allocations !== undefined
        ? await this.resolveAllocations(
            existing.type,
            partyId as string,
            dto.allocations,
            this.prisma,
            dto.currencyId ?? existing.currencyId,
          )
        : undefined;

    return this.prisma.$transaction(async (tx) => {
      if (resolvedAllocations) {
        await tx.financialTransactionAllocation.deleteMany({
          where: { transactionId: id },
        });
      }
      const transaction = await tx.financialTransaction.update({
        where: { id },
        data: {
          currencyId: dto.currencyId,
          transactionDate: dto.transactionDate
            ? new Date(dto.transactionDate)
            : undefined,
          paymentSourceId: dto.paymentSourceId,
          receivingAccountId: dto.receivingAccountId,
          expenseAccountId:
            existing.type === 'EXPENSE_PAYMENT'
              ? dto.expenseAccountId
              : undefined,
          amount: dto.amount,
          referenceNumber: dto.referenceNumber,
          notes: dto.notes,
          updatedBy: userId ?? null,
          ...(resolvedAllocations
            ? { allocations: { create: resolvedAllocations } }
            : {}),
        },
        include: TRANSACTION_INCLUDE,
      });
      await this.activityService.log(
        id,
        FinancialTransactionActivityType.TRANSACTION_UPDATED,
        `${this.label(existing.type)} ${transaction.transactionNumber} updated`,
        undefined,
        tx,
      );
      return transaction;
    });
  }

  /** Locks the header and makes its allocations "real" — invoice payment status is derived from CONFIRMED transactions only. */
  async confirm(
    id: string,
    userId?: string,
    outerTx?: Prisma.TransactionClient,
  ) {
    await this.findOneById(id, outerTx);

    return this.inTransaction(outerTx, async (tx) => {
      // Serialize concurrent confirms (double-click, client retry) on this
      // row; the loser then sees CONFIRMED below and returns without
      // posting a second Journal Entry.
      await tx.$queryRaw`
        SELECT id FROM financial_transactions
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
      const existing = await tx.financialTransaction.findUniqueOrThrow({
        where: { id },
        include: { allocations: true },
      });
      if (existing.status === FinancialTransactionStatus.CONFIRMED) {
        // Idempotent retry — already confirmed and posted exactly once.
        return tx.financialTransaction.findUniqueOrThrow({
          where: { id },
          include: TRANSACTION_INCLUDE,
        });
      }
      if (existing.status !== FinancialTransactionStatus.DRAFT) {
        throw new BadRequestException(
          `Cannot confirm ${this.label(existing.type)} ${existing.transactionNumber} from ${existing.status}.`,
        );
      }
      if (existing.type === 'CUSTOMER_REFUND') {
        this.assertRefundFullyAllocated(
          Number(existing.amount),
          existing.allocations.map((a) => ({
            invoiceId: a.salesReturnId ?? '',
            allocatedAmount: Number(a.allocatedAmount),
          })),
        );
      }
      for (const allocation of existing.allocations) {
        const invoiceId =
          allocation.salesInvoiceId ??
          allocation.purchaseInvoiceId ??
          allocation.salesReturnId;
        if (!invoiceId) continue;
        await lockInvoiceRow(tx, existing.type, invoiceId);
        await this.assertAllocationWithinRemaining(
          existing.type,
          invoiceId,
          Number(allocation.allocatedAmount),
          id,
          tx,
        );
      }
      if (existing.type === 'CUSTOMER_REFUND') {
        await this.assertRefundWithinCustomerCredit(existing, tx);
      }
      const transaction = await tx.financialTransaction.update({
        where: { id },
        data: {
          status: FinancialTransactionStatus.CONFIRMED,
          confirmedAt: new Date(),
          confirmedBy: userId ?? null,
        },
        include: TRANSACTION_INCLUDE,
      });
      await this.activityService.log(
        id,
        FinancialTransactionActivityType.TRANSACTION_CONFIRMED,
        `${this.label(existing.type)} ${transaction.transactionNumber} confirmed`,
        undefined,
        tx,
      );
      await this.postingEngine.post(existing.type, id, userId, tx);
      return transaction;
    });
  }

  /** Reverses a Confirmed transaction — reverses its posted Journal Entry, removes its allocations (freeing invoice balance), and marks it Cancelled. */
  async cancel(id: string, userId?: string) {
    const existing = await this.findOneById(id);
    if (existing.status !== FinancialTransactionStatus.CONFIRMED) {
      throw new BadRequestException(
        `Cannot cancel ${this.label(existing.type)} ${existing.transactionNumber} from ${existing.status}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await this.postingEngine.reverse(existing.type, id, userId, tx);
      await tx.financialTransactionAllocation.deleteMany({
        where: { transactionId: id },
      });
      const transaction = await tx.financialTransaction.update({
        where: { id },
        data: {
          status: FinancialTransactionStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: userId ?? null,
        },
        include: TRANSACTION_INCLUDE,
      });
      await this.activityService.log(
        id,
        FinancialTransactionActivityType.TRANSACTION_CANCELLED,
        `${this.label(existing.type)} ${transaction.transactionNumber} cancelled`,
        undefined,
        tx,
      );
      return transaction;
    });
  }

  /** Soft-delete — only once no longer actively progressing (Draft/Cancelled), mirroring every other document's archive rule. */
  async archive(id: string, userId?: string) {
    const existing = await this.findOneById(id);
    const archivableFrom: FinancialTransactionStatus[] = [
      FinancialTransactionStatus.DRAFT,
      FinancialTransactionStatus.CANCELLED,
    ];
    if (!archivableFrom.includes(existing.status)) {
      throw new BadRequestException(
        `Cannot archive ${this.label(existing.type)} ${existing.transactionNumber} while it is ${existing.status}.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.financialTransaction.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: userId ?? null },
        include: TRANSACTION_INCLUDE,
      });
      await this.activityService.log(
        id,
        FinancialTransactionActivityType.TRANSACTION_ARCHIVED,
        `${this.label(existing.type)} ${transaction.transactionNumber} archived`,
        undefined,
        tx,
      );
      return transaction;
    });
  }

  /** Hard delete — Draft only. A Draft transaction never posted anything, so unlike Archive (which only hides it) this removes it entirely; once Confirmed, use Cancel/Archive instead — a posted document is never truly deleted. */
  async remove(id: string) {
    const existing = await this.findOneById(id);
    if (existing.status !== FinancialTransactionStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot delete ${this.label(existing.type)} ${existing.transactionNumber} while it is ${existing.status}. Only Draft can be deleted.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.financialTransactionActivity.deleteMany({
        where: { transactionId: id },
      });
      await tx.financialTransactionAllocation.deleteMany({
        where: { transactionId: id },
      });
      await tx.financialTransaction.delete({ where: { id } });
    });
  }

  /** Adds one allocation to a Confirmed transaction — the standalone "Allocate" business operation. */
  async allocate(
    id: string,
    dto: AllocationInputDto,
    userId?: string,
    outerTx?: Prisma.TransactionClient,
  ) {
    const existing = await this.findOneById(id, outerTx);
    if (existing.status !== FinancialTransactionStatus.CONFIRMED) {
      throw new BadRequestException(
        `Cannot allocate against ${this.label(existing.type)} ${existing.transactionNumber} while it is ${existing.status}.`,
      );
    }
    this.assertAllocationsEditable(existing);
    const partyId = existing.partnerId ?? undefined;
    const [resolved] = await this.resolveAllocations(
      existing.type,
      partyId as string,
      [dto],
      outerTx,
    );

    return this.inTransaction(outerTx, async (tx) => {
      await lockInvoiceRow(tx, existing.type, dto.invoiceId);
      const currentAllocated =
        await tx.financialTransactionAllocation.aggregate({
          where: { transactionId: id },
          _sum: { allocatedAmount: true },
        });
      const alreadyAllocated = Number(
        currentAllocated._sum.allocatedAmount ?? 0,
      );
      // Same capacity rule as create(): a fee the bank kept still settles
      // the invoice, so a receipt can clear `amount + feeAmount`.
      const capacity =
        Number(existing.amount) + Number(existing.feeAmount ?? 0);
      if (alreadyAllocated + dto.allocatedAmount > capacity + 0.005) {
        throw new BadRequestException(
          `Cannot allocate ${dto.allocatedAmount} — only ${this.round2(capacity - alreadyAllocated)} remains unallocated on this ${this.label(existing.type).toLowerCase()}.`,
        );
      }
      await this.assertAllocationWithinRemaining(
        existing.type,
        dto.invoiceId,
        dto.allocatedAmount,
        undefined,
        tx,
      );
      await tx.financialTransactionAllocation.create({
        data: {
          transactionId: id,
          ...resolved,
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        },
      });
      const transaction = await tx.financialTransaction.findUniqueOrThrow({
        where: { id },
        include: TRANSACTION_INCLUDE,
      });
      await this.activityService.log(
        id,
        FinancialTransactionActivityType.INVOICE_ALLOCATED,
        `Allocated ${dto.allocatedAmount} to invoice on ${transaction.transactionNumber}`,
        undefined,
        tx,
      );
      return transaction;
    });
  }

  /** Removes one allocation from a Confirmed transaction — the standalone "Unallocate" business operation. */
  async unallocate(id: string, allocationId: string, userId?: string) {
    const existing = await this.findOneById(id);
    if (existing.status !== FinancialTransactionStatus.CONFIRMED) {
      throw new BadRequestException(
        `Cannot unallocate on ${this.label(existing.type)} ${existing.transactionNumber} while it is ${existing.status}.`,
      );
    }
    this.assertAllocationsEditable(existing);
    const allocation =
      await this.prisma.financialTransactionAllocation.findFirst({
        where: { id: allocationId, transactionId: id },
      });
    if (!allocation) {
      throw new NotFoundException(`Allocation ${allocationId} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.financialTransactionAllocation.delete({
        where: { id: allocationId },
      });
      const transaction = await tx.financialTransaction.findUniqueOrThrow({
        where: { id },
        include: TRANSACTION_INCLUDE,
      });
      await this.activityService.log(
        id,
        FinancialTransactionActivityType.INVOICE_UNALLOCATED,
        `Removed allocation from ${transaction.transactionNumber}`,
        { removedBy: userId ?? null },
        tx,
      );
      return transaction;
    });
  }

  activityFor(id: string) {
    return this.activityService.findAllForTransaction(id);
  }

  /**
   * Open Invoices — every CONFIRMED invoice for this party with a
   * remaining balance greater than zero, for the Allocation Grid / "Pay
   * All Remaining" UI. Never trusts a stored payment-status column
   * (there isn't one) — always derives it fresh.
   */
  async getOpenInvoices(
    type: FinancialTransactionType,
    partyId: string,
  ): Promise<OpenInvoiceRow[]> {
    if (type === 'CUSTOMER_RECEIPT') {
      const invoices = await this.prisma.salesInvoice.findMany({
        where: { partnerId: partyId, status: 'CONFIRMED', deletedAt: null },
        select: {
          id: true,
          invoiceNumber: true,
          grandTotal: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      const allocated = await sumConfirmedAllocations(
        this.prisma,
        'salesInvoiceId',
        invoices.map((i) => i.id),
      );
      return this.buildOpenInvoiceRows(invoices, allocated);
    }

    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: { partnerId: partyId, status: 'CONFIRMED', deletedAt: null },
      select: {
        id: true,
        invoiceNumber: true,
        grandTotal: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const allocated = await sumConfirmedAllocations(
      this.prisma,
      'purchaseInvoiceId',
      invoices.map((i) => i.id),
    );
    return this.buildOpenInvoiceRows(invoices, allocated);
  }

  private buildOpenInvoiceRows(
    invoices: {
      id: string;
      invoiceNumber: string;
      grandTotal: Prisma.Decimal;
      createdAt: Date;
    }[],
    allocated: Map<string, number>,
  ): OpenInvoiceRow[] {
    return invoices
      .map((invoice) => {
        const summary = computeInvoicePaymentSummary(
          Number(invoice.grandTotal),
          allocated.get(invoice.id) ?? 0,
        );
        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          documentDate: invoice.createdAt.toISOString(),
          ...summary,
        };
      })
      .filter((row) => row.remainingBalance > 0);
  }

  private async findOneById(id: string, client: DbClient = this.prisma) {
    const transaction = await client.financialTransaction.findFirst({
      where: { id, deletedAt: null },
    });
    if (!transaction) {
      throw new NotFoundException(`Financial transaction ${id} not found`);
    }
    return transaction;
  }

  private async assertActiveParty(
    type: FinancialTransactionType,
    dto: {
      partnerId?: string;
      expenseAccountId?: string;
    },
  ): Promise<string> {
    if (type === 'CUSTOMER_RECEIPT' || type === 'CUSTOMER_REFUND') {
      if (!dto.partnerId) {
        throw new BadRequestException(
          `partnerId is required for a ${this.label(type)}.`,
        );
      }
      await this.partnersService.assertActiveForRole(
        dto.partnerId,
        PartnerRoleType.CUSTOMER,
      );
      return dto.partnerId;
    }
    if (type === 'EXPENSE_PAYMENT') {
      if (!dto.expenseAccountId) {
        throw new BadRequestException(
          'expenseAccountId is required for an Expense Payment Voucher.',
        );
      }
      const account = await this.prisma.chartOfAccount.findFirst({
        where: { id: dto.expenseAccountId, deletedAt: null },
      });
      if (!account) {
        throw new BadRequestException('Expense account not found.');
      }
      if (!account.allowsPosting) {
        throw new BadRequestException(
          `"${account.name}" is a header account and cannot be posted to directly — choose a leaf expense account.`,
        );
      }
      // No party (customer/supplier) — allocations never apply to an
      // Expense Payment Voucher, so the returned id is never used.
      return '';
    }
    if (!dto.partnerId) {
      throw new BadRequestException(
        'partnerId is required for a Supplier Payment Voucher.',
      );
    }
    await this.partnersService.assertActiveForRole(
      dto.partnerId,
      PartnerRoleType.SUPPLIER,
    );
    return dto.partnerId;
  }

  private assertAllocationsWithinAmount(
    amount: number,
    allocations: AllocationInputDto[],
    feeAmount = 0,
  ) {
    const total = allocations.reduce((sum, a) => sum + a.allocatedAmount, 0);
    const available = amount + feeAmount;
    if (total > available) {
      throw new BadRequestException(
        feeAmount > 0
          ? `Total allocated (${total}) cannot exceed the transaction amount plus fee (${available}).`
          : `Total allocated (${total}) cannot exceed the transaction amount (${amount}).`,
      );
    }
  }

  /** Resolves + validates each allocation's invoice against the transaction's own party, returning Prisma-ready create objects. */
  private async resolveAllocations(
    type: FinancialTransactionType,
    partyId: string,
    allocations: AllocationInputDto[],
    client: DbClient = this.prisma,
    /** CUSTOMER_REFUND — the refund's currency every refunded return must share. */
    refundCurrencyId: string | null = null,
  ): Promise<
    Prisma.FinancialTransactionAllocationUncheckedCreateWithoutTransactionInput[]
  > {
    const resolved: Prisma.FinancialTransactionAllocationUncheckedCreateWithoutTransactionInput[] =
      [];
    const seenReturns = new Set<string>();
    for (const allocation of allocations) {
      if (type === 'CUSTOMER_REFUND') {
        const salesReturn = await client.salesReturn.findFirst({
          where: { id: allocation.invoiceId, deletedAt: null },
        });
        if (!salesReturn || salesReturn.partnerId !== partyId) {
          throw new BadRequestException(
            `المرتجع غير تابع لهذا العميل — Sales Return ${allocation.invoiceId} does not belong to this customer.`,
          );
        }
        if (!REFUNDABLE_RETURN_STATUSES.includes(salesReturn.status)) {
          throw new BadRequestException(
            `لا يمكن رد مبلغ إلا لمرتجع مُرحّل — Only a posted (Confirmed) Sales Return can be refunded; ${salesReturn.returnNumber} is ${salesReturn.status}.`,
          );
        }
        if (seenReturns.has(salesReturn.id)) {
          throw new BadRequestException(
            `المرتجع ${salesReturn.returnNumber} مكرر في الرد — Sales Return ${salesReturn.returnNumber} appears more than once on this refund.`,
          );
        }
        seenReturns.add(salesReturn.id);
        if ((salesReturn.currencyId ?? null) !== refundCurrencyId) {
          throw new BadRequestException(
            `عملة الرد يجب أن تطابق عملة المرتجع ${salesReturn.returnNumber} — The refund currency must match the currency of Sales Return ${salesReturn.returnNumber}.`,
          );
        }
        // Fail fast at Draft too; re-checked under a row lock at Confirm.
        await this.assertAllocationWithinRemaining(
          type,
          salesReturn.id,
          allocation.allocatedAmount,
          undefined,
          client,
        );
        resolved.push({
          salesReturnId: salesReturn.id,
          allocatedAmount: allocation.allocatedAmount,
        });
        continue;
      }
      if (type === 'CUSTOMER_RECEIPT') {
        const invoice = await client.salesInvoice.findFirst({
          where: { id: allocation.invoiceId, deletedAt: null },
        });
        if (!invoice || invoice.partnerId !== partyId) {
          throw new BadRequestException(
            `Invoice ${allocation.invoiceId} does not belong to this partner.`,
          );
        }
        // TASK-050 — a cancelled invoice can never receive a payment allocation.
        if (invoice.status === SalesDocumentStatus.CANCELLED) {
          throw new BadRequestException(
            `Cannot allocate a payment to cancelled Sales Invoice ${invoice.invoiceNumber}.`,
          );
        }
        resolved.push({
          salesInvoiceId: allocation.invoiceId,
          allocatedAmount: allocation.allocatedAmount,
        });
      } else {
        const invoice = await client.purchaseInvoice.findFirst({
          where: { id: allocation.invoiceId, deletedAt: null },
        });
        if (!invoice || invoice.partnerId !== partyId) {
          throw new BadRequestException(
            `Invoice ${allocation.invoiceId} does not belong to this partner.`,
          );
        }
        // TASK-050 — a cancelled invoice can never receive a payment allocation.
        if (invoice.status === PurchaseDocumentStatus.CANCELLED) {
          throw new BadRequestException(
            `Cannot allocate a payment to cancelled Purchase Invoice ${invoice.invoiceNumber}.`,
          );
        }
        resolved.push({
          purchaseInvoiceId: allocation.invoiceId,
          allocatedAmount: allocation.allocatedAmount,
        });
      }
    }
    return resolved;
  }

  /** Caps a new/confirming allocation at the invoice's currently-remaining balance (excluding this transaction's own prior confirmed allocations, if any). */
  private async assertAllocationWithinRemaining(
    type: FinancialTransactionType,
    invoiceId: string,
    amount: number,
    excludeTransactionId?: string,
    client: DbClient = this.prisma,
  ) {
    if (type === 'CUSTOMER_REFUND') {
      const salesReturn = await client.salesReturn.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      const refunded = await this.sumConfirmedRefunds(
        [invoiceId],
        client,
        excludeTransactionId,
      );
      const remaining = Math.max(
        this.round2(
          Number(salesReturn.grandTotal) - (refunded.get(invoiceId) ?? 0),
        ),
        0,
      );
      if (amount > remaining + 0.005) {
        throw new BadRequestException(
          `لا يمكن رد ${amount} — المتبقي القابل للرد على المرتجع ${salesReturn.returnNumber} هو ${remaining} فقط. — Cannot refund ${amount} against Sales Return ${salesReturn.returnNumber}: only ${remaining} of its credit remains unrefunded.`,
        );
      }
      return;
    }
    const invoiceKey =
      type === 'CUSTOMER_RECEIPT' ? 'salesInvoiceId' : 'purchaseInvoiceId';
    const invoice =
      type === 'CUSTOMER_RECEIPT'
        ? await client.salesInvoice.findUniqueOrThrow({
            where: { id: invoiceId },
          })
        : await client.purchaseInvoice.findUniqueOrThrow({
            where: { id: invoiceId },
          });

    const aggregate = await client.financialTransactionAllocation.aggregate({
      where: {
        [invoiceKey]: invoiceId,
        transaction: {
          status: FinancialTransactionStatus.CONFIRMED,
          ...(excludeTransactionId
            ? { id: { not: excludeTransactionId } }
            : {}),
        },
      },
      _sum: { allocatedAmount: true },
    });
    const summary = computeInvoicePaymentSummary(
      Number(invoice.grandTotal),
      Number(aggregate._sum.allocatedAmount ?? 0),
    );
    if (amount > summary.remainingBalance + 0.005) {
      throw new BadRequestException(
        `Cannot allocate ${amount} to invoice ${invoiceId} — only ${summary.remainingBalance} remains unpaid.`,
      );
    }
  }

  /**
   * Refundable position of one Sales Return — its unrefunded credit, capped
   * by the customer's credit on the posted ledger (see
   * `RefundableReturnSummary`). Drives the "Refund" prefill; Confirm
   * re-enforces both limits under row locks.
   */
  async getRefundableReturn(
    salesReturnId: string,
  ): Promise<RefundableReturnSummary> {
    const salesReturn = await this.prisma.salesReturn.findFirst({
      where: { id: salesReturnId, deletedAt: null },
    });
    if (!salesReturn) {
      throw new NotFoundException(`Sales Return ${salesReturnId} not found`);
    }
    const [summary] = await this.buildRefundableSummaries([salesReturn]);
    return summary;
  }

  /** Every posted Sales Return of this customer that still has money to refund. */
  async listRefundableReturns(
    partnerId: string,
  ): Promise<RefundableReturnSummary[]> {
    const returns = await this.prisma.salesReturn.findMany({
      where: {
        partnerId,
        deletedAt: null,
        status: { in: REFUNDABLE_RETURN_STATUSES },
      },
      orderBy: { createdAt: 'asc' },
    });
    const summaries = await this.buildRefundableSummaries(returns);
    return summaries.filter((row) => row.refundableAmount > 0);
  }

  private async buildRefundableSummaries(
    returns: Prisma.SalesReturnGetPayload<object>[],
  ): Promise<RefundableReturnSummary[]> {
    if (returns.length === 0) return [];
    const [refunded, balances] = await Promise.all([
      this.sumConfirmedRefunds(
        returns.map((r) => r.id),
        this.prisma,
      ),
      partnerLedgerBalances(this.prisma, [
        ...new Set(returns.map((r) => r.partnerId)),
      ]),
    ]);
    return returns.map((salesReturn) => {
      const grandTotal = this.round2(Number(salesReturn.grandTotal));
      const refundedTotal = this.round2(refunded.get(salesReturn.id) ?? 0);
      const unrefundedCredit = Math.max(
        this.round2(grandTotal - refundedTotal),
        0,
      );
      const receivable = balances.get(salesReturn.partnerId)?.receivable ?? 0;
      const rate =
        salesReturn.exchangeRate != null ? Number(salesReturn.exchangeRate) : 1;
      const customerCreditBalance =
        receivable < 0 && rate > 0 ? this.round2(-receivable / rate) : 0;
      const posted = REFUNDABLE_RETURN_STATUSES.includes(salesReturn.status);
      return {
        salesReturnId: salesReturn.id,
        returnNumber: salesReturn.returnNumber,
        partnerId: salesReturn.partnerId,
        currencyId: salesReturn.currencyId,
        status: salesReturn.status,
        grandTotal,
        refundedTotal,
        unrefundedCredit,
        customerCreditBalance,
        refundableAmount: posted
          ? Math.min(unrefundedCredit, customerCreditBalance)
          : 0,
      };
    });
  }

  /** CONFIRMED refund allocations per Sales Return (the "refunded" side of a credit note). */
  private async sumConfirmedRefunds(
    salesReturnIds: string[],
    client: DbClient,
    excludeTransactionId?: string,
  ): Promise<Map<string, number>> {
    const grouped = await client.financialTransactionAllocation.groupBy({
      by: ['salesReturnId'],
      where: {
        salesReturnId: { in: salesReturnIds },
        transaction: {
          status: FinancialTransactionStatus.CONFIRMED,
          ...(excludeTransactionId
            ? { id: { not: excludeTransactionId } }
            : {}),
        },
      },
      _sum: { allocatedAmount: true },
    });
    return new Map(
      grouped
        .filter((row) => row.salesReturnId)
        .map((row) => [
          row.salesReturnId as string,
          Number(row._sum.allocatedAmount ?? 0),
        ]),
    );
  }

  /** A refund pays back exactly what it allocates to returns — never an unallocated payout. */
  private assertRefundFullyAllocated(
    amount: number,
    allocations: AllocationInputDto[],
  ) {
    if (allocations.length === 0 || allocations.some((a) => !a.invoiceId)) {
      throw new BadRequestException(
        'حدد المرتجع الذي يُرد مبلغه — A Customer Refund must be allocated to the posted Sales Return(s) it pays back.',
      );
    }
    const total = this.round2(
      allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0),
    );
    if (Math.abs(total - this.round2(amount)) > 0.005) {
      throw new BadRequestException(
        `مبلغ الرد (${amount}) يجب أن يساوي إجمالي المخصص للمرتجعات (${total}) — The refund amount (${amount}) must equal the total allocated to Sales Returns (${total}); an unallocated or over-allocated refund is not allowed.`,
      );
    }
  }

  /**
   * Last line of defence at Confirm: the refund (valued at the refunded
   * returns' own rates — exactly what it will debit AR) may not exceed the
   * credit the customer actually holds on the posted ledger. A return that
   * only offset an unpaid invoice leaves nothing to refund. The partner row
   * is locked so two refunds for the same customer serialize.
   */
  private async assertRefundWithinCustomerCredit(
    refund: {
      partnerId: string | null;
      transactionNumber: string;
      allocations: { salesReturnId: string | null; allocatedAmount: unknown }[];
    },
    tx: Prisma.TransactionClient,
  ) {
    if (!refund.partnerId) return;
    await tx.$queryRaw`
      SELECT id FROM partners WHERE id = ${refund.partnerId}::uuid FOR UPDATE
    `;
    const returnIds = refund.allocations
      .map((a) => a.salesReturnId)
      .filter((value): value is string => !!value);
    const rates = new Map(
      (
        await tx.salesReturn.findMany({
          where: { id: { in: returnIds } },
          select: { id: true, exchangeRate: true },
        })
      ).map((r) => [r.id, r.exchangeRate != null ? Number(r.exchangeRate) : 1]),
    );
    const refundFunctional = this.round2(
      refund.allocations.reduce(
        (sum, a) =>
          sum +
          this.round2(
            Number(a.allocatedAmount) * (rates.get(a.salesReturnId ?? '') ?? 1),
          ),
        0,
      ),
    );
    const balances = await partnerLedgerBalances(tx, [refund.partnerId]);
    const receivable = balances.get(refund.partnerId)?.receivable ?? 0;
    const credit = Math.max(this.round2(-receivable), 0);
    if (refundFunctional > credit + 0.005) {
      throw new BadRequestException(
        `رصيد العميل الدائن (${credit}) لا يغطي مبلغ الرد (${refundFunctional}) — The customer's credit balance on the ledger (${credit}) does not cover refund ${refund.transactionNumber} (${refundFunctional}). A return that only offset an unpaid invoice leaves nothing to refund.`,
      );
    }
  }

  /** The currency of the first refunded return — a refund's default currency. */
  private async firstReturnCurrency(
    allocations: AllocationInputDto[],
    client: DbClient = this.prisma,
  ): Promise<string | undefined> {
    const first = allocations[0]?.invoiceId;
    if (!first) return undefined;
    const salesReturn = await client.salesReturn.findFirst({
      where: { id: first, deletedAt: null },
      select: { currencyId: true },
    });
    return salesReturn?.currencyId ?? undefined;
  }

  /** A confirmed refund's allocation is its whole meaning — fixed once posted. */
  private assertAllocationsEditable(transaction: {
    type: FinancialTransactionType;
    transactionNumber: string;
  }) {
    if (transaction.type === 'CUSTOMER_REFUND') {
      throw new BadRequestException(
        `لا يمكن تعديل تخصيص رد مؤكد — The allocation of confirmed refund ${transaction.transactionNumber} is fixed. Cancel it and record a new refund instead.`,
      );
    }
  }

  private inTransaction<T>(
    outerTx: Prisma.TransactionClient | undefined,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return outerTx ? work(outerTx) : this.prisma.$transaction(work);
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private label(type: FinancialTransactionType): string {
    if (type === 'CUSTOMER_RECEIPT') return 'Customer Receipt Voucher';
    if (type === 'CUSTOMER_REFUND') return 'Customer Refund';
    if (type === 'EXPENSE_PAYMENT') return 'Expense Payment Voucher';
    return 'Supplier Payment Voucher';
  }
}
