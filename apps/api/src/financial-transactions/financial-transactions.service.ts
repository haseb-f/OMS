import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinancialTransactionStatus,
  FinancialTransactionType,
  Prisma,
  SalesDocumentStatus,
  PurchaseDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { CustomersService } from '../customers/customers.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import {
  FinancialTransactionActivityService,
  FinancialTransactionActivityType,
} from './activities/financial-transaction-activity.service';
import { buildDateRangeFilter } from '../sales/shared/sales-list-query.util';
import { PostingEngineService } from '../accounting/posting-engine/posting-engine.service';
import type { CompanyContext } from '../common/decorators/current-company-context.decorator';
import {
  computeInvoicePaymentSummary,
  sumConfirmedAllocations,
} from './shared/invoice-payment.util';
import type { AllocationInputDto } from './shared/allocation-input.dto';
import type { FindFinancialTransactionsQueryDto } from './shared/find-financial-transactions-query.dto';
import { prismaEnumFilter } from '../common/query/enum-list';

const NUMBERING_DOCUMENT_TYPE: Record<FinancialTransactionType, string> = {
  CUSTOMER_RECEIPT: 'CUSTOMER_RECEIPT',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  EXPENSE_PAYMENT: 'EXPENSE_PAYMENT',
};

const TRANSACTION_INCLUDE = {
  customer: true,
  supplier: true,
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
    },
  },
} satisfies Prisma.FinancialTransactionInclude;

export interface FinancialTransactionCreateInput {
  customerId?: string;
  supplierId?: string;
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
  referenceNumber?: string;
  notes?: string;
  allocations?: AllocationInputDto[];
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
    private readonly customersService: CustomersService,
    private readonly suppliersService: SuppliersService,
    private readonly activityService: FinancialTransactionActivityService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  async create(
    type: FinancialTransactionType,
    dto: FinancialTransactionCreateInput,
    userId?: string,
    context: CompanyContext = { companyId: null, branchId: null },
  ) {
    const partyId = await this.assertActiveParty(type, dto);
    const allocations = dto.allocations ?? [];
    this.assertAllocationsWithinAmount(dto.amount, allocations);
    const resolvedAllocations = await this.resolveAllocations(
      type,
      partyId,
      allocations,
    );

    const transactionNumber = await this.numberingEngine.generateNumber(
      NUMBERING_DOCUMENT_TYPE[type],
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const transaction = await tx.financialTransaction.create({
          data: {
            transactionNumber,
            type,
            customerId:
              type === 'CUSTOMER_RECEIPT' ? dto.customerId : undefined,
            supplierId:
              type === 'SUPPLIER_PAYMENT' ? dto.supplierId : undefined,
            expenseAccountId:
              type === 'EXPENSE_PAYMENT' ? dto.expenseAccountId : undefined,
            currencyId: dto.currencyId,
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
          'Invalid customer, supplier, currency, payment source, receiving account, or invoice reference.',
        );
      }
      throw error;
    }
  }

  async findAll(
    type: FinancialTransactionType,
    query: FindFinancialTransactionsQueryDto & {
      customerId?: string | string[];
      supplierId?: string | string[];
    },
  ) {
    const where: Prisma.FinancialTransactionWhereInput = {
      type,
      deletedAt: null,
      status: prismaEnumFilter(query.status),
      customerId: prismaEnumFilter(query.customerId),
      supplierId: prismaEnumFilter(query.supplierId),
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

    const partyId = existing.customerId ?? existing.supplierId ?? undefined;
    if (dto.amount !== undefined || dto.allocations !== undefined) {
      const amount = dto.amount ?? Number(existing.amount);
      this.assertAllocationsWithinAmount(amount, dto.allocations ?? []);
    }

    const resolvedAllocations =
      dto.allocations !== undefined
        ? await this.resolveAllocations(
            existing.type,
            partyId as string,
            dto.allocations,
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
  async confirm(id: string, userId?: string) {
    const existing = await this.findOneById(id);
    if (existing.status !== FinancialTransactionStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot confirm ${this.label(existing.type)} ${existing.transactionNumber} from ${existing.status}.`,
      );
    }

    const full = await this.prisma.financialTransaction.findUniqueOrThrow({
      where: { id },
      include: { allocations: true },
    });
    for (const allocation of full.allocations) {
      const invoiceId =
        allocation.salesInvoiceId ?? allocation.purchaseInvoiceId;
      if (!invoiceId) continue;
      await this.assertAllocationWithinRemaining(
        existing.type,
        invoiceId,
        Number(allocation.allocatedAmount),
        id,
      );
    }

    return this.prisma.$transaction(async (tx) => {
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
  async allocate(id: string, dto: AllocationInputDto, userId?: string) {
    const existing = await this.findOneById(id);
    if (existing.status !== FinancialTransactionStatus.CONFIRMED) {
      throw new BadRequestException(
        `Cannot allocate against ${this.label(existing.type)} ${existing.transactionNumber} while it is ${existing.status}.`,
      );
    }
    const partyId = existing.customerId ?? existing.supplierId ?? undefined;
    const [resolved] = await this.resolveAllocations(
      existing.type,
      partyId as string,
      [dto],
    );

    const currentAllocated =
      await this.prisma.financialTransactionAllocation.aggregate({
        where: { transactionId: id },
        _sum: { allocatedAmount: true },
      });
    const alreadyAllocated = Number(currentAllocated._sum.allocatedAmount ?? 0);
    if (alreadyAllocated + dto.allocatedAmount > Number(existing.amount)) {
      throw new BadRequestException(
        `Cannot allocate ${dto.allocatedAmount} — only ${Number(existing.amount) - alreadyAllocated} remains unallocated on this ${this.label(existing.type).toLowerCase()}.`,
      );
    }
    await this.assertAllocationWithinRemaining(
      existing.type,
      dto.invoiceId,
      dto.allocatedAmount,
    );

    return this.prisma.$transaction(async (tx) => {
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
        where: { customerId: partyId, status: 'CONFIRMED', deletedAt: null },
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
      where: { supplierId: partyId, status: 'CONFIRMED', deletedAt: null },
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

  private async findOneById(id: string) {
    const transaction = await this.prisma.financialTransaction.findFirst({
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
      customerId?: string;
      supplierId?: string;
      expenseAccountId?: string;
    },
  ): Promise<string> {
    if (type === 'CUSTOMER_RECEIPT') {
      if (!dto.customerId) {
        throw new BadRequestException(
          'customerId is required for a Customer Receipt Voucher.',
        );
      }
      await this.customersService.assertActiveCustomer(dto.customerId);
      return dto.customerId;
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
    if (!dto.supplierId) {
      throw new BadRequestException(
        'supplierId is required for a Supplier Payment Voucher.',
      );
    }
    await this.suppliersService.assertActiveSupplier(dto.supplierId);
    return dto.supplierId;
  }

  private assertAllocationsWithinAmount(
    amount: number,
    allocations: AllocationInputDto[],
  ) {
    const total = allocations.reduce((sum, a) => sum + a.allocatedAmount, 0);
    if (total > amount) {
      throw new BadRequestException(
        `Total allocated (${total}) cannot exceed the transaction amount (${amount}).`,
      );
    }
  }

  /** Resolves + validates each allocation's invoice against the transaction's own party, returning Prisma-ready create objects. */
  private async resolveAllocations(
    type: FinancialTransactionType,
    partyId: string,
    allocations: AllocationInputDto[],
  ): Promise<
    Prisma.FinancialTransactionAllocationUncheckedCreateWithoutTransactionInput[]
  > {
    const resolved: Prisma.FinancialTransactionAllocationUncheckedCreateWithoutTransactionInput[] =
      [];
    for (const allocation of allocations) {
      if (type === 'CUSTOMER_RECEIPT') {
        const invoice = await this.prisma.salesInvoice.findFirst({
          where: { id: allocation.invoiceId, deletedAt: null },
        });
        if (!invoice || invoice.customerId !== partyId) {
          throw new BadRequestException(
            `Invoice ${allocation.invoiceId} does not belong to this customer.`,
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
        const invoice = await this.prisma.purchaseInvoice.findFirst({
          where: { id: allocation.invoiceId, deletedAt: null },
        });
        if (!invoice || invoice.supplierId !== partyId) {
          throw new BadRequestException(
            `Invoice ${allocation.invoiceId} does not belong to this supplier.`,
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
  ) {
    const invoiceKey =
      type === 'CUSTOMER_RECEIPT' ? 'salesInvoiceId' : 'purchaseInvoiceId';
    const invoice =
      type === 'CUSTOMER_RECEIPT'
        ? await this.prisma.salesInvoice.findUniqueOrThrow({
            where: { id: invoiceId },
          })
        : await this.prisma.purchaseInvoice.findUniqueOrThrow({
            where: { id: invoiceId },
          });

    const aggregate =
      await this.prisma.financialTransactionAllocation.aggregate({
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
    if (amount > summary.remainingBalance) {
      throw new BadRequestException(
        `Cannot allocate ${amount} to invoice ${invoiceId} — only ${summary.remainingBalance} remains unpaid.`,
      );
    }
  }

  private label(type: FinancialTransactionType): string {
    if (type === 'CUSTOMER_RECEIPT') return 'Customer Receipt Voucher';
    if (type === 'EXPENSE_PAYMENT') return 'Expense Payment Voucher';
    return 'Supplier Payment Voucher';
  }
}
