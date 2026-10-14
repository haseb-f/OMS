import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinancialTransactionStatus,
  FinancialTransactionType,
  PartnerRoleType,
  PaymentMatchStatus,
  PaymentSettlementStatus,
  PaymentStatus,
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
  NOT_AGENT_COLLECTION,
  PAYABLE_PURCHASE_INVOICE_STATUSES,
  PAYABLE_SALES_INVOICE_STATUSES,
  appliedCreditByReturn,
  loadInvoiceSettlements,
  loadReturnCredits,
  lockInvoiceRow,
  type InvoicePaymentSummary,
} from './shared/invoice-payment.util';
import { ALLOCATION_FX_SOURCE_TYPE } from '../accounting/posting-providers/allocation-fx-posting.provider';
import { financialTransactionOrderBy } from './shared/find-financial-transactions-query.dto';
import { assertFeeWithinAmount } from './shared/fee-cap';
import { assertVoucherDateNotInFuture } from './shared/voucher-date';
import type { AllocationInputDto } from './shared/allocation-input.dto';
import type { FindFinancialTransactionsQueryDto } from './shared/find-financial-transactions-query.dto';
import { prismaEnumFilter } from '../common/query/enum-list';
import { partnerLedgerBalances } from '../accounting/reports/partner-ledger-balance';
import {
  advanceRateOf,
  loadStoreOrderMoneyPosition,
} from './shared/store-order-money';
import {
  STORE_ORDER_PAYMENT_NOTE_PREFIX as STORE_ORDER_PAYMENT_PREFIX,
  storeOrderOfReceipt,
  syncAdvanceRefundConsumption,
} from './shared/store-order-receipts';
import { lockStoreOrderRow } from '../store-orders/store-order-payment-settlement.util';

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
  costCenter: { select: { id: true, code: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
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
      storeOrder: {
        select: { id: true, internalOrderId: true },
      },
    },
  },
} satisfies Prisma.FinancialTransactionInclude;

/**
 * One allocation line as the service receives it: `invoiceId` names the
 * settled document of the transaction's type; a CUSTOMER_REFUND line may name
 * a store order (`storeOrderId`) instead — its verified, not-invoiced advance
 * (R15, D15-11). Exactly one target per line.
 */
export interface AllocationLineInput {
  invoiceId?: string;
  storeOrderId?: string;
  allocatedAmount: number;
}

export interface FinancialTransactionCreateInput {
  /** Required party for receipts / payments / refunds; EXPENSE_PAYMENT: optional supplier counterparty (never posted to AP, never allocated). */
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
  /** What was spent — expense vouchers (carried onto the journal line). */
  description?: string;
  notes?: string;
  allocations?: AllocationLineInput[];
  /** R13 B2 — one key per opened form; see `findIdempotentReplay`. */
  idempotencyKey?: string;
}

/** Update input — the optional links may be cleared with `null`. */
export type FinancialTransactionUpdateInput = Omit<
  Partial<FinancialTransactionCreateInput>,
  'partnerId' | 'costCenterId' | 'projectId'
> & {
  partnerId?: string | null;
  costCenterId?: string | null;
  projectId?: string | null;
};

/** List filters shared by every voucher list (expense lists add account filters). */
export type FinancialTransactionListQuery =
  FindFinancialTransactionsQueryDto & {
    partnerId?: string | string[];
    /** CUSTOMER_REFUND — only refunds paying back this Sales Return. */
    salesReturnId?: string;
    /** EXPENSE_PAYMENT — debited expense account(s). */
    expenseAccountId?: string | string[];
    /** Paid from / received into — the receiving (cash / bank) account(s). */
    receivingAccountId?: string | string[];
  };

/** Per-currency total of a voucher list (reversed vouchers excluded). */
export interface FinancialTransactionCurrencyTotal {
  currencyId: string | null;
  currencyCode: string | null;
  count: number;
  amount: number;
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
  /** R20 — the invoice's currency: a voucher settles invoices of its own currency only. */
  currencyId: string | null;
  currencyCode: string | null;
  grandTotal: number;
  /** R22 D2 — cash paid (confirmed allocations); `allocatedTotal` is its compatibility alias. */
  paidTotal: number;
  allocatedTotal: number;
  /** R22 D2 — posted credit notes applied to the invoice (never cash). */
  creditedTotal: number;
  remainingBalance: number;
  paymentStatus: InvoicePaymentSummary['paymentStatus'];
}

/**
 * R20 — a party's payment position in one currency (customer / supplier
 * profile): what its posted invoices still owe, the money its confirmed
 * vouchers moved, how much of it settles invoices and how much stays an
 * unapplied advance. Never one figure across currencies.
 */
export interface PartyPaymentPosition {
  currencyId: string | null;
  currencyCode: string | null;
  openInvoices: number;
  outstanding: number;
  received: number;
  applied: number;
  unapplied: number;
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
    const replay = await this.findIdempotentReplay(type, dto, outerTx);
    if (replay) return replay;
    assertVoucherDateNotInFuture(dto.transactionDate);
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
      assertFeeWithinAmount(feeAmount, dto.amount);
    }
    const allocations = dto.allocations ?? [];
    if (type === 'EXPENSE_PAYMENT')
      this.assertNoExpenseAllocations(allocations);
    let currencyId = dto.currencyId;
    if (type === 'CUSTOMER_REFUND') {
      this.assertRefundFullyAllocated(dto.amount, allocations);
      // A refund pays back a credit note / an order advance in that
      // document's own currency.
      currencyId ??= await this.firstRefundCurrency(allocations, outerTx);
    } else {
      this.assertAllocationsWithinAmount(dto.amount, allocations, feeAmount);
    }
    const resolvedAllocations = await this.resolveAllocations(
      type,
      partyId,
      allocations,
      outerTx,
      currencyId ?? null,
      { companyId: context.companyId ?? null },
    );
    // R20 — a receipt / payment is in its invoices' currency (none chosen →
    // theirs); another currency is refused, never cleared at a wrong value.
    currencyId = await this.settlementCurrency(
      type,
      currencyId,
      allocations,
      outerTx,
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
            partnerId: dto.partnerId || undefined,
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
            description: dto.description,
            notes: dto.notes,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
            allocations: { create: resolvedAllocations },
            idempotencyKey: dto.idempotencyKey || undefined,
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
      // Lost a concurrent race on the same key (double click): the winner's
      // document is the answer. Inside a caller's transaction the error must
      // propagate so that transaction aborts; the caller replays then.
      if (!outerTx && this.isIdempotencyKeyClash(error)) {
        const winner = await this.findIdempotentReplay(type, dto);
        if (winner) return winner;
      }
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

  /**
   * Create + Confirm (+ Posting Engine) atomically — all or nothing. With an
   * idempotency key, a repeated call returns the first document (already
   * confirmed and posted once) — never a second document or journal entry.
   */
  async createConfirmed(
    type: FinancialTransactionType,
    dto: FinancialTransactionCreateInput,
    userId?: string,
    context: CompanyContext = { companyId: null, branchId: null },
  ) {
    const replay = await this.findIdempotentReplay(type, dto, this.prisma, {
      requireConfirmed: true,
    });
    if (replay) return replay;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const created = await this.create(type, dto, userId, context, tx);
          return this.confirm(created.id, userId, tx);
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (error) {
      if (this.isIdempotencyKeyClash(error)) {
        const winner = await this.findIdempotentReplay(type, dto, this.prisma, {
          requireConfirmed: true,
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  /**
   * R13 B2 — the document an earlier request with the same idempotency key
   * created, or null. The key is only a retry token: reusing it for a
   * different document (type, party, account, amount, currency, money
   * route, date, fee, allocations) is a 409, never a silent return of an
   * unrelated document. A deleted original, or (for Create + Confirm) an
   * original that is still a DRAFT, is a distinct 409 — never returned as
   * if it were the confirmed answer.
   */
  private async findIdempotentReplay(
    type: FinancialTransactionType,
    dto: FinancialTransactionCreateInput,
    client: DbClient = this.prisma,
    options: { requireConfirmed?: boolean } = {},
  ) {
    if (!dto.idempotencyKey) return null;
    const existing = await client.financialTransaction.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: TRANSACTION_INCLUDE,
    });
    if (!existing) return null;
    if (existing.deletedAt !== null) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_DELETED',
        message: `This form was already submitted as ${existing.transactionNumber}, which has since been deleted — reopen the form to record a new document.`,
      });
    }
    const same = (requested: string | undefined, stored: string | null) =>
      requested === undefined || requested === (stored ?? undefined);
    const allocationKey = (target: string | null | undefined, amount: number) =>
      `${target ?? ''}:${this.round2(amount).toFixed(2)}`;
    const requestedAllocations = (dto.allocations ?? [])
      .map((a) =>
        allocationKey(a.invoiceId ?? a.storeOrderId, a.allocatedAmount),
      )
      .sort();
    const storedAllocations = existing.allocations
      .map((a) =>
        allocationKey(
          a.salesInvoiceId ??
            a.purchaseInvoiceId ??
            a.salesReturnId ??
            a.storeOrderId,
          Number(a.allocatedAmount),
        ),
      )
      .sort();
    const sameDate =
      dto.transactionDate === undefined ||
      new Date(dto.transactionDate).getTime() ===
        existing.transactionDate.getTime();
    const matches =
      existing.type === type &&
      this.round2(Number(existing.amount)) === this.round2(dto.amount) &&
      this.round2(Number(existing.feeAmount ?? 0)) ===
        this.round2(dto.feeAmount ?? 0) &&
      sameDate &&
      requestedAllocations.join('|') === storedAllocations.join('|') &&
      same(dto.partnerId || undefined, existing.partnerId) &&
      same(
        type === 'EXPENSE_PAYMENT' ? dto.expenseAccountId : undefined,
        existing.expenseAccountId,
      ) &&
      same(dto.currencyId, existing.currencyId) &&
      same(dto.receivingAccountId, existing.receivingAccountId) &&
      same(dto.paymentSourceId, existing.paymentSourceId);
    if (!matches) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: `This form was already submitted as ${existing.transactionNumber} with different details — reopen the form to record a new document.`,
      });
    }
    if (
      options.requireConfirmed &&
      existing.status === FinancialTransactionStatus.DRAFT
    ) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_DRAFT',
        message: `The earlier request saved ${existing.transactionNumber} as a draft — open it and confirm it explicitly.`,
      });
    }
    return existing;
  }

  private isIdempotencyKeyClash(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    return JSON.stringify(error.meta ?? {}).includes('idempotency_key');
  }

  /**
   * One filter for a voucher list and its totals. Expense vouchers filter
   * on their own transaction (expense) date and also search the
   * description; every other list keeps filtering on the record date.
   */
  private buildListWhere(
    type: FinancialTransactionType,
    query: FinancialTransactionListQuery,
  ): Prisma.FinancialTransactionWhereInput {
    const where: Prisma.FinancialTransactionWhereInput = {
      type,
      deletedAt: null,
      status: prismaEnumFilter(query.status),
      partnerId: prismaEnumFilter(query.partnerId),
      expenseAccountId: prismaEnumFilter(query.expenseAccountId),
      receivingAccountId: prismaEnumFilter(query.receivingAccountId),
      ...(query.salesReturnId
        ? { allocations: { some: { salesReturnId: query.salesReturnId } } }
        : {}),
    };
    if (query.search) {
      where.OR = [
        { transactionNumber: { contains: query.search, mode: 'insensitive' } },
        { referenceNumber: { contains: query.search, mode: 'insensitive' } },
        ...(type === 'EXPENSE_PAYMENT'
          ? [
              {
                description: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
            ]
          : []),
      ];
    }
    if (query.dateFrom || query.dateTo) {
      const range = buildDateRangeFilter(query.dateFrom, query.dateTo);
      if (type === 'EXPENSE_PAYMENT') where.transactionDate = range;
      else where.createdAt = range;
    }
    return where;
  }

  async findAll(
    type: FinancialTransactionType,
    query: FinancialTransactionListQuery,
  ) {
    const where = this.buildListWhere(type, query);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.financialTransaction.findMany({
        where,
        include: TRANSACTION_INCLUDE,
        orderBy: financialTransactionOrderBy(query),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.financialTransaction.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /**
   * Totals of a filtered voucher list, one per currency — unlike currencies
   * are never added together. Cancelled (reversed) vouchers are excluded:
   * their entry was reversed, nothing was spent. A voucher without a
   * currency is in the functional currency (Settings → Accounting).
   */
  async totalsByCurrency(
    type: FinancialTransactionType,
    query: FinancialTransactionListQuery,
  ): Promise<FinancialTransactionCurrencyTotal[]> {
    const where: Prisma.FinancialTransactionWhereInput = {
      AND: [
        this.buildListWhere(type, query),
        { status: { not: FinancialTransactionStatus.CANCELLED } },
      ],
    };
    const grouped = await this.prisma.financialTransaction.groupBy({
      by: ['currencyId'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });
    if (grouped.length === 0) return [];
    const settings = await this.prisma.postingSettings.findFirst({
      select: { functionalCurrencyId: true },
    });
    const ids = [
      ...new Set(
        grouped
          .map((row) => row.currencyId ?? settings?.functionalCurrencyId)
          .filter((id): id is string => !!id),
      ),
    ];
    const currencies = new Map(
      (
        await this.prisma.currency.findMany({
          where: { id: { in: ids } },
          select: { id: true, code: true },
        })
      ).map((currency) => [currency.id, currency.code]),
    );
    const byCurrency = new Map<string, FinancialTransactionCurrencyTotal>();
    for (const row of grouped) {
      const currencyId =
        row.currencyId ?? settings?.functionalCurrencyId ?? null;
      const key = currencyId ?? '';
      const current = byCurrency.get(key) ?? {
        currencyId,
        currencyCode: currencyId ? (currencies.get(currencyId) ?? null) : null,
        count: 0,
        amount: 0,
      };
      current.count += row._count._all;
      current.amount = this.round2(
        current.amount + Number(row._sum.amount ?? 0),
      );
      byCurrency.set(key, current);
    }
    return [...byCurrency.values()].sort((a, b) =>
      (a.currencyCode ?? '').localeCompare(b.currencyCode ?? ''),
    );
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

  /**
   * R22 F7 — a voucher route acts on vouchers of its own type only: a
   * receipt route never reads or changes a supplier payment, refund or
   * expense voucher (404, as for an unknown id). Every voucher controller
   * calls this before an id-based operation (get, update, delete, confirm,
   * cancel, archive, allocate, unallocate, allocation change, activities).
   */
  async assertRouteType(
    type: FinancialTransactionType,
    id: string,
  ): Promise<void> {
    const found = await this.prisma.financialTransaction.findFirst({
      where: { id, type, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException(`${this.label(type)} ${id} not found`);
    }
  }

  async update(
    id: string,
    dto: FinancialTransactionUpdateInput,
    userId?: string,
  ) {
    const existing = await this.findOneById(id);
    if (existing.status !== FinancialTransactionStatus.DRAFT) {
      throw new BadRequestException(
        `Only a Draft ${this.label(existing.type).toLowerCase()} can be edited.`,
      );
    }
    assertVoucherDateNotInFuture(dto.transactionDate);

    const partyId = existing.partnerId ?? undefined;
    const isExpense = existing.type === 'EXPENSE_PAYMENT';
    if (isExpense) {
      if (dto.allocations !== undefined) {
        this.assertNoExpenseAllocations(dto.allocations);
      }
      if (dto.expenseAccountId) {
        await this.assertExpenseAccount(dto.expenseAccountId);
      }
      if (dto.partnerId) {
        await this.partnersService.assertActiveForRole(
          dto.partnerId,
          PartnerRoleType.SUPPLIER,
        );
      }
    }
    if (dto.amount !== undefined || dto.allocations !== undefined) {
      const amount = dto.amount ?? Number(existing.amount);
      if (existing.type === 'CUSTOMER_REFUND') {
        const lines =
          dto.allocations ??
          (
            await this.prisma.financialTransactionAllocation.findMany({
              where: { transactionId: id },
            })
          ).map((a) => this.refundLineOf(a));
        this.assertRefundFullyAllocated(amount, lines);
      } else {
        // The stored lines stand when only the amount changes: lowering a
        // draft's amount below what it already allocates is refused (R18).
        const lines =
          dto.allocations ??
          (
            await this.prisma.financialTransactionAllocation.findMany({
              where: { transactionId: id },
              select: { allocatedAmount: true },
            })
          ).map((a) => ({ allocatedAmount: Number(a.allocatedAmount) }));
        this.assertAllocationsWithinAmount(
          amount,
          lines,
          Number(existing.feeAmount ?? 0),
        );
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
            { companyId: existing.companyId },
          )
        : undefined;
    let currencyId = dto.currencyId;
    if (dto.allocations !== undefined || dto.currencyId !== undefined) {
      const lines =
        dto.allocations ??
        (
          await this.prisma.financialTransactionAllocation.findMany({
            where: { transactionId: id },
            select: { salesInvoiceId: true, purchaseInvoiceId: true },
          })
        ).map((a) => ({
          invoiceId: a.salesInvoiceId ?? a.purchaseInvoiceId ?? undefined,
        }));
      currencyId = await this.settlementCurrency(
        existing.type,
        dto.currencyId ?? existing.currencyId ?? undefined,
        lines,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (resolvedAllocations) {
        await tx.financialTransactionAllocation.deleteMany({
          where: { transactionId: id },
        });
      }
      const transaction = await tx.financialTransaction.update({
        where: { id },
        data: {
          currencyId,
          transactionDate: dto.transactionDate
            ? new Date(dto.transactionDate)
            : undefined,
          paymentSourceId: dto.paymentSourceId,
          receivingAccountId: dto.receivingAccountId,
          expenseAccountId: isExpense ? dto.expenseAccountId : undefined,
          // An expense voucher's counterparty is optional and may change or
          // be cleared; a receipt / payment party is fixed at create.
          partnerId: isExpense ? dto.partnerId : undefined,
          costCenterId: dto.costCenterId,
          projectId: dto.projectId,
          amount: dto.amount,
          referenceNumber: dto.referenceNumber,
          description: dto.description,
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
      // R22 F8 — the entry is booked on the voucher date (D1): never ahead.
      assertVoucherDateNotInFuture(existing.transactionDate);
      if (existing.type === 'CUSTOMER_REFUND') {
        this.assertRefundFullyAllocated(
          Number(existing.amount),
          existing.allocations.map((a) => this.refundLineOf(a)),
        );
        // R15 — every refund of this customer serializes HERE, before any
        // cap is read, so two concurrent refunds can never both pass the
        // same limit (order advance, return credit or ledger credit).
        await this.lockPartnerRow(tx, existing.partnerId);
      } else {
        // R18 — a voucher never applies more than the money it moved (plus
        // its recorded fee), however its draft was edited.
        this.assertAllocationsWithinAmount(
          Number(existing.amount),
          existing.allocations.map((a) => ({
            allocatedAmount: Number(a.allocatedAmount),
          })),
          Number(existing.feeAmount ?? 0),
        );
      }
      // R20 — what this voucher applies to each document, summed per
      // document (two lines on one invoice never pass its balance one by
      // one), locked in a stable order so concurrent confirms never deadlock.
      const perDocument = new Map<string, number>();
      for (const allocation of existing.allocations) {
        if (allocation.storeOrderId) {
          await lockStoreOrderRow(tx, allocation.storeOrderId);
          await this.assertAdvanceRefundWithin(
            allocation.storeOrderId,
            Number(allocation.allocatedAmount),
            tx,
          );
          continue;
        }
        const invoiceId =
          allocation.salesInvoiceId ??
          allocation.purchaseInvoiceId ??
          allocation.salesReturnId;
        if (!invoiceId) continue;
        perDocument.set(
          invoiceId,
          this.round2(
            (perDocument.get(invoiceId) ?? 0) +
              Number(allocation.allocatedAmount),
          ),
        );
      }
      if (existing.type !== 'CUSTOMER_REFUND') {
        await this.assertSettlementScope(tx, existing, [...perDocument.keys()]);
      }
      for (const invoiceId of [...perDocument.keys()].sort()) {
        await lockInvoiceRow(tx, existing.type, invoiceId);
        await this.assertAllocationWithinRemaining(
          existing.type,
          invoiceId,
          perDocument.get(invoiceId) ?? 0,
          id,
          tx,
        );
      }
      // Re-checked at posting time: drafts saved before R20 may carry
      // another currency than their invoices.
      await this.settlementCurrency(
        existing.type,
        existing.currencyId,
        [...perDocument.keys()].map((invoiceId) => ({ invoiceId })),
        tx,
      );
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
      // R22 A3 — the lines a voucher carries when it is posted settle on its
      // voucher date (D1: the date its entry is booked); a later Allocate
      // keeps its own date. As-of aging reads this date.
      await tx.financialTransactionAllocation.updateMany({
        where: { transactionId: id },
        data: { allocationDate: existing.transactionDate },
      });
      // R15 (review H1) — the advance this refund pays back leaves the
      // order's receipts: never allocatable to an invoice again.
      for (const storeOrderId of this.advanceOrders(existing.allocations)) {
        await syncAdvanceRefundConsumption(tx, storeOrderId, userId);
      }
      await this.activityService.log(
        id,
        FinancialTransactionActivityType.TRANSACTION_CONFIRMED,
        `${this.label(existing.type)} ${transaction.transactionNumber} confirmed`,
        undefined,
        tx,
      );
      await this.postingEngine.post(existing.type, id, userId, tx);
      // R22 contract 6 — the fresh voucher (posting froze its rate).
      return tx.financialTransaction.findUniqueOrThrow({
        where: { id },
        include: TRANSACTION_INCLUDE,
      });
    });
  }

  /** Reverses a Confirmed transaction — reverses its posted Journal Entry, removes its allocations (freeing invoice balance), and marks it Cancelled. */
  async cancel(id: string, userId?: string) {
    await this.findOneById(id);
    return this.prisma.$transaction((tx) => this.cancelInTx(tx, id, userId));
  }

  /**
   * Cancel inside the caller's transaction (row-locked). A Customer Receipt
   * that posts a Store Order payment claim (PaymentReceiptLink, or the
   * historical `STORE_ORDER_PAYMENT:<id>` note while that claim is VERIFIED)
   * is refused: cancelling it here would leave the claim VERIFIED with no
   * receipt. Only the reconciliation correction path and the audited payment
   * reversal (R15) may cancel it, and they say so explicitly with
   * `allowLinkedClaim` (each resets the claim itself).
   */
  async cancelInTx(
    tx: Prisma.TransactionClient,
    id: string,
    userId?: string,
    opts: {
      allowLinkedClaim?: boolean;
      /** Appended to the activity description (audited correction reason). */
      note?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    await tx.$queryRaw`
      SELECT id FROM financial_transactions
      WHERE id = ${id}::uuid
      FOR UPDATE
    `;
    const existing = await this.findOneById(id, tx);
    if (existing.status !== FinancialTransactionStatus.CONFIRMED) {
      throw new BadRequestException(
        `Cannot cancel ${this.label(existing.type)} ${existing.transactionNumber} from ${existing.status}.`,
      );
    }
    const allocations = await tx.financialTransactionAllocation.findMany({
      where: { transactionId: id },
      select: { storeOrderId: true, allocatedAmount: true },
    });
    if (existing.type === FinancialTransactionType.CUSTOMER_RECEIPT) {
      this.assertReceiptNotRefunded(existing, allocations);
      if (!opts.allowLinkedClaim) {
        await this.assertNotClaimReceipt(tx, existing);
      }
    }

    await this.postingEngine.reverse(existing.type, id, userId, tx);
    // R22 D6 — the FX later allocations realized goes with the voucher.
    await this.postingEngine.reverse(ALLOCATION_FX_SOURCE_TYPE, id, userId, tx);
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
      `${this.label(existing.type)} ${transaction.transactionNumber} cancelled${opts.note ? ` — ${opts.note}` : ''}`,
      opts.metadata,
      tx,
    );
    // A cancelled advance refund gives its money back to the order's receipts.
    if (existing.type === FinancialTransactionType.CUSTOMER_REFUND) {
      for (const storeOrderId of this.advanceOrders(allocations)) {
        await lockStoreOrderRow(tx, storeOrderId);
        await syncAdvanceRefundConsumption(tx, storeOrderId, userId);
      }
    }
    return transaction;
  }

  /** The store orders whose advance a refund's lines pay back. */
  private advanceOrders(allocations: { storeOrderId: string | null }[]) {
    return [
      ...new Set(
        allocations
          .map((allocation) => allocation.storeOrderId)
          .filter((value): value is string => !!value),
      ),
    ];
  }

  /**
   * A receipt whose money was paid back by an order's advance refund cannot
   * be cancelled (reversed / corrected) while that refund stands — the
   * refund would pay out money that never came in. Cancel the refund first.
   */
  private assertReceiptNotRefunded(
    receipt: { transactionNumber: string },
    allocations: { storeOrderId: string | null; allocatedAmount: unknown }[],
  ) {
    const refunded = allocations
      .filter((allocation) => allocation.storeOrderId)
      .reduce((sum, allocation) => sum + Number(allocation.allocatedAmount), 0);
    if (refunded > 0.005) {
      throw new ConflictException({
        code: 'RECEIPT_REFUNDED',
        message: `رُدّ ${this.round2(refunded).toFixed(2)} من سند القبض ${receipt.transactionNumber} للعميل — ألغِ سند الرد أولاً — ${this.round2(refunded).toFixed(2)} of Customer Receipt ${receipt.transactionNumber} was paid back to the customer by an order advance refund: cancel that refund first, then cancel or reverse the receipt.`,
      });
    }
  }

  /** 409 when this receipt posts a Store Order payment claim (see cancelInTx). */
  private async assertNotClaimReceipt(
    tx: Prisma.TransactionClient,
    receipt: { id: string; transactionNumber: string; notes: string | null },
  ) {
    const link = await tx.paymentReceiptLink.findUnique({
      where: { financialTransactionId: receipt.id },
      select: { paymentId: true },
    });
    let paymentId = link?.paymentId ?? null;
    if (!paymentId && receipt.notes?.startsWith(STORE_ORDER_PAYMENT_PREFIX)) {
      const noted = receipt.notes.slice(STORE_ORDER_PAYMENT_PREFIX.length);
      const verified = await tx.payment.findFirst({
        where: { id: noted, status: PaymentStatus.VERIFIED },
        select: { id: true },
      });
      paymentId = verified?.id ?? null;
    }
    if (!paymentId) return;
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: {
        paymentNumber: true,
        settledAmount: true,
        settlementStatus: true,
        _count: {
          select: { matches: { where: { status: PaymentMatchStatus.ACTIVE } } },
        },
      },
    });
    const settled =
      Number(payment.settledAmount) > 0 ||
      payment.settlementStatus === PaymentSettlementStatus.PARTIALLY_SETTLED ||
      payment.settlementStatus === PaymentSettlementStatus.SETTLED;
    const how = settled
      ? `Payment ${payment.paymentNumber} is already included in a provider settlement — reverse the settlement first, then correct the match in Finance → Payment reconciliation ("Correct match").`
      : payment._count.matches > 0
        ? `Correct it from Finance → Payment reconciliation → the payment method workspace → "Correct match"; that reverses this receipt and returns the claim to review in one audited step.`
        : `Cancelling it here would leave the claim verified with no receipt; a payment verified in error is reversed from the payment itself ("Reverse payment", audited) — that reverses this receipt with it.`;
    throw new ConflictException(
      `Customer Receipt ${receipt.transactionNumber} posts Store Order payment ${payment.paymentNumber} and cannot be cancelled directly. ${how}`,
    );
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
    this.assertAllocatable(existing, 'allocate against');
    this.assertAllocationsEditable(existing);
    const partyId = existing.partnerId ?? undefined;
    const [resolved] = await this.resolveAllocations(
      existing.type,
      partyId as string,
      [dto],
      outerTx,
      null,
      { companyId: existing.companyId, skipRemainingCheck: true },
    );
    // R20 — a posted voucher's currency is fixed: it settles invoices of
    // that currency only.
    await this.settlementCurrency(
      existing.type,
      existing.currencyId,
      [dto],
      outerTx,
    );

    return this.inTransaction(outerTx, async (tx) => {
      // R15 (review H1) — a store-order receipt: the order row first (same
      // lock order as refunds), its advance refunds carried on its receipts,
      // then this receipt's row — refunded money is never allocatable.
      const storeOrderId = await storeOrderOfReceipt(tx, id);
      if (storeOrderId) {
        await lockStoreOrderRow(tx, storeOrderId);
        await syncAdvanceRefundConsumption(tx, storeOrderId, userId);
      }
      const locked = await this.lockVoucher(tx, id, 'allocate against');
      await this.assertSettlementScope(tx, locked, [dto.invoiceId]);
      await lockInvoiceRow(tx, existing.type, dto.invoiceId);
      const [currentAllocated, sameInvoiceLine] = await Promise.all([
        tx.financialTransactionAllocation.aggregate({
          where: { transactionId: id },
          _sum: { allocatedAmount: true },
        }),
        tx.financialTransactionAllocation.findFirst({
          where: {
            transactionId: id,
            OR: [
              { salesInvoiceId: dto.invoiceId },
              { purchaseInvoiceId: dto.invoiceId },
            ],
          },
          select: { id: true, allocatedAmount: true },
        }),
      ]);
      this.assertWithinVoucherCapacity(
        locked,
        Number(currentAllocated._sum.allocatedAmount ?? 0) +
          dto.allocatedAmount,
        dto.allocatedAmount,
      );
      await this.assertAllocationWithinRemaining(
        existing.type,
        dto.invoiceId,
        dto.allocatedAmount,
        undefined,
        tx,
      );
      // R20 — one line per invoice per voucher: more money for an invoice the
      // voucher already settles grows that line (both checks above saw the
      // combined amount), never a second line.
      if (sameInvoiceLine) {
        await tx.financialTransactionAllocation.update({
          where: { id: sameInvoiceLine.id },
          data: {
            allocatedAmount: this.round2(
              Number(sameInvoiceLine.allocatedAmount) + dto.allocatedAmount,
            ),
            updatedBy: userId ?? null,
          },
        });
      } else {
        await tx.financialTransactionAllocation.create({
          data: {
            transactionId: id,
            ...resolved,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
          },
        });
      }
      await this.syncAllocationFx(tx, locked, userId);
      // R22 contract 6 — the fresh voucher, its `updatedAt` moved with the
      // change (a system allocation keeps the last human editor).
      const transaction = await tx.financialTransaction.update({
        where: { id },
        data: {
          updatedAt: new Date(),
          ...(userId ? { updatedBy: userId } : {}),
        },
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

  /**
   * R22 W1 (contract 3) — changes the amount of one line of a Confirmed
   * receipt / payment in ONE transaction: the same voucher + invoice locks
   * and guards as Allocate, no new cash entry (only the allocation FX
   * adjustment follows). A refused change leaves the old line untouched.
   */
  async updateAllocation(
    id: string,
    allocationId: string,
    allocatedAmount: number,
    userId?: string,
  ) {
    const existing = await this.findOneById(id);
    this.assertAllocatable(existing, 'change an allocation on');
    this.assertAllocationsEditable(existing);
    if (!(allocatedAmount > 0)) {
      throw new BadRequestException(
        'The allocated amount must be greater than zero — remove the line to unallocate it.',
      );
    }
    return this.prisma.$transaction(
      async (tx) => {
        const storeOrderId = await storeOrderOfReceipt(tx, id);
        if (storeOrderId) {
          await lockStoreOrderRow(tx, storeOrderId);
          await syncAdvanceRefundConsumption(tx, storeOrderId, userId);
        }
        const locked = await this.lockVoucher(
          tx,
          id,
          'change an allocation on',
        );
        const line = await tx.financialTransactionAllocation.findFirst({
          where: { id: allocationId, transactionId: id },
        });
        if (!line) {
          throw new NotFoundException(`Allocation ${allocationId} not found`);
        }
        const invoiceId = line.salesInvoiceId ?? line.purchaseInvoiceId;
        if (!invoiceId) {
          throw new ConflictException({
            code: 'ADVANCE_REFUND_ALLOCATION',
            message:
              'هذا الجزء من سند القبض رُدّ للعميل — ألغِ سند الرد بدلاً من ذلك — This part of the receipt was paid back to the customer by an order advance refund; cancel that refund instead.',
          });
        }
        await this.assertSettlementScope(tx, locked, [invoiceId]);
        await lockInvoiceRow(tx, locked.type, invoiceId);
        const others = await tx.financialTransactionAllocation.aggregate({
          where: { transactionId: id, id: { not: allocationId } },
          _sum: { allocatedAmount: true },
        });
        this.assertWithinVoucherCapacity(
          locked,
          Number(others._sum.allocatedAmount ?? 0) + allocatedAmount,
          allocatedAmount,
        );
        // The invoice's open balance without this voucher, which this line
        // may take up to (the voucher has one line per invoice).
        await this.assertAllocationWithinRemaining(
          locked.type,
          invoiceId,
          allocatedAmount,
          id,
          tx,
        );
        await tx.financialTransactionAllocation.update({
          where: { id: allocationId },
          data: {
            allocatedAmount: this.round2(allocatedAmount),
            allocationDate: new Date(),
            updatedBy: userId ?? null,
          },
        });
        await this.syncAllocationFx(tx, locked, userId);
        const transaction = await tx.financialTransaction.update({
          where: { id },
          data: { updatedBy: userId ?? null },
          include: TRANSACTION_INCLUDE,
        });
        await this.activityService.log(
          id,
          FinancialTransactionActivityType.INVOICE_ALLOCATED,
          `Allocation changed from ${this.round2(Number(line.allocatedAmount))} to ${this.round2(allocatedAmount)} on ${transaction.transactionNumber}`,
          {
            allocationId,
            previousAmount: this.round2(Number(line.allocatedAmount)),
            allocatedAmount: this.round2(allocatedAmount),
            changedBy: userId ?? null,
          },
          tx,
        );
        return transaction;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  /** Removes one allocation from a Confirmed transaction — the standalone "Unallocate" business operation. */
  async unallocate(id: string, allocationId: string, userId?: string) {
    const existing = await this.findOneById(id);
    this.assertAllocatable(existing, 'unallocate on');
    this.assertAllocationsEditable(existing);

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockVoucher(tx, id, 'unallocate on');
      const allocation = await tx.financialTransactionAllocation.findFirst({
        where: { id: allocationId, transactionId: id },
      });
      if (!allocation) {
        throw new NotFoundException(`Allocation ${allocationId} not found`);
      }
      if (
        locked.type === FinancialTransactionType.CUSTOMER_RECEIPT &&
        allocation.storeOrderId
      ) {
        throw new ConflictException({
          code: 'ADVANCE_REFUND_ALLOCATION',
          message:
            'هذا الجزء من سند القبض رُدّ للعميل — ألغِ سند الرد بدلاً من ذلك — This part of the receipt was paid back to the customer by an order advance refund; cancel that refund instead.',
        });
      }
      await tx.financialTransactionAllocation.delete({
        where: { id: allocationId },
      });
      // R22 D6 — the FX this line realized is reversed with it.
      await this.syncAllocationFx(tx, locked, userId);
      const transaction = await tx.financialTransaction.update({
        where: { id },
        data: { updatedBy: userId ?? null },
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

  /** A standalone allocation change needs a Confirmed voucher (drafts are edited as a whole). */
  private assertAllocatable(
    voucher: {
      status: FinancialTransactionStatus;
      type: FinancialTransactionType;
      transactionNumber: string;
    },
    verb: string,
  ) {
    if (voucher.status !== FinancialTransactionStatus.CONFIRMED) {
      throw new BadRequestException(
        `Cannot ${verb} ${this.label(voucher.type)} ${voucher.transactionNumber} while it is ${voucher.status}.`,
      );
    }
  }

  /**
   * R22 L1 — locks the voucher row and re-reads it under the lock: a voucher
   * cancelled by a concurrent request after the caller's first read never
   * gains (or loses) an allocation.
   */
  private async lockVoucher(
    tx: Prisma.TransactionClient,
    id: string,
    verb: string,
  ) {
    await tx.$queryRaw`
      SELECT id FROM financial_transactions WHERE id = ${id}::uuid FOR UPDATE
    `;
    const current = await tx.financialTransaction.findUniqueOrThrow({
      where: { id },
    });
    if (current.deletedAt) {
      throw new NotFoundException(`Financial transaction ${id} not found`);
    }
    this.assertAllocatable(current, verb);
    return current;
  }

  /** Same capacity rule as create(): a fee the bank kept still settles the invoice, so a receipt can clear `amount + feeAmount`. */
  private assertWithinVoucherCapacity(
    voucher: {
      type: FinancialTransactionType;
      amount: Prisma.Decimal;
      feeAmount: Prisma.Decimal | null;
    },
    totalAllocated: number,
    requested: number,
  ) {
    const capacity = Number(voucher.amount) + Number(voucher.feeAmount ?? 0);
    if (totalAllocated > capacity + 0.005) {
      throw new BadRequestException(
        `Cannot allocate ${requested} — only ${this.round2(capacity - (totalAllocated - requested))} remains unallocated on this ${this.label(voucher.type).toLowerCase()}.`,
      );
    }
  }

  /**
   * R22 L2 + L5 — who may settle these invoices: never an agent-order
   * collection (its entry credited Agent funds payable, not the customer's
   * AR — the customer's invoice would read paid while AR stays open), and
   * never a voucher of another company than the invoice's.
   */
  private async assertSettlementScope(
    client: DbClient,
    voucher: {
      id: string;
      type: FinancialTransactionType;
      companyId: string | null;
      transactionNumber: string;
    },
    invoiceIds: string[],
  ) {
    if (invoiceIds.length === 0) return;
    if (voucher.type === FinancialTransactionType.CUSTOMER_RECEIPT) {
      const agentCollection = await client.financialTransaction.count({
        where: {
          id: voucher.id,
          paymentReceiptLink: { is: { payment: { agentId: { not: null } } } },
        },
      });
      if (agentCollection > 0) {
        throw new BadRequestException({
          code: 'AGENT_COLLECTION_NOT_ALLOCATABLE',
          message: `سند القبض ${voucher.transactionNumber} تحصيل لطلب وكيل ويُقيد لحساب الوكيل — لا يسدد فواتير العميل — Customer Receipt ${voucher.transactionNumber} posts an agent order's collection to Agent funds payable; it never settles the customer's invoices.`,
        });
      }
    }
    if (voucher.companyId) {
      await this.assertInvoicesInCompany(
        client,
        voucher.type,
        voucher.companyId,
        invoiceIds,
      );
    }
  }

  private async assertInvoicesInCompany(
    client: DbClient,
    type: FinancialTransactionType,
    companyId: string,
    invoiceIds: string[],
  ) {
    const where = {
      id: { in: invoiceIds },
      companyId: { not: null, notIn: [companyId] },
    };
    const foreign =
      type === 'CUSTOMER_RECEIPT'
        ? await client.salesInvoice.findFirst({
            where,
            select: { invoiceNumber: true },
          })
        : type === 'SUPPLIER_PAYMENT'
          ? await client.purchaseInvoice.findFirst({
              where,
              select: { invoiceNumber: true },
            })
          : null;
    if (foreign) {
      throw new BadRequestException({
        code: 'COMPANY_MISMATCH',
        message: `الفاتورة ${foreign.invoiceNumber} تابعة لشركة أخرى — Invoice ${foreign.invoiceNumber} belongs to another company than this voucher; a voucher settles its own company's invoices only.`,
      });
    }
  }

  /**
   * R22 P1 / P2 / D6 — after any allocation change on a posted receipt /
   * payment, the allocation FX adjustment is restated through the Posting
   * Engine: the current one (if any) reversed, the one the current lines
   * require posted (none when the rates agree). Never a cash entry.
   */
  private async syncAllocationFx(
    tx: Prisma.TransactionClient,
    voucher: { id: string; type: FinancialTransactionType },
    userId?: string,
  ) {
    if (
      voucher.type !== FinancialTransactionType.CUSTOMER_RECEIPT &&
      voucher.type !== FinancialTransactionType.SUPPLIER_PAYMENT
    ) {
      return;
    }
    await this.postingEngine.reverse(
      ALLOCATION_FX_SOURCE_TYPE,
      voucher.id,
      userId,
      tx,
    );
    await this.postingEngine.post(
      ALLOCATION_FX_SOURCE_TYPE,
      voucher.id,
      userId,
      tx,
    );
  }

  activityFor(id: string) {
    return this.activityService.findAllForTransaction(id);
  }

  /**
   * Open Invoices — every posted (confirmed) invoice for this party with a
   * remaining balance greater than zero, for the Allocation Grid / "Pay
   * All Remaining" UI. Never trusts a stored payment-status column
   * (there isn't one) — always derives it fresh (R22 D2: cash and applied
   * credit notes).
   */
  async getOpenInvoices(
    type: FinancialTransactionType,
    partyId: string,
  ): Promise<OpenInvoiceRow[]> {
    const select = {
      id: true,
      invoiceNumber: true,
      grandTotal: true,
      createdAt: true,
      currencyId: true,
      currency: { select: { code: true } },
    } as const;
    if (type === 'CUSTOMER_RECEIPT') {
      const invoices = await this.prisma.salesInvoice.findMany({
        where: {
          partnerId: partyId,
          status: { in: PAYABLE_SALES_INVOICE_STATUSES },
          deletedAt: null,
        },
        select,
        orderBy: { createdAt: 'asc' },
      });
      return this.buildOpenInvoiceRows(
        invoices,
        await loadInvoiceSettlements(this.prisma, 'salesInvoiceId', invoices),
      );
    }

    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        partnerId: partyId,
        status: { in: PAYABLE_PURCHASE_INVOICE_STATUSES },
        deletedAt: null,
      },
      select,
      orderBy: { createdAt: 'asc' },
    });
    return this.buildOpenInvoiceRows(
      invoices,
      await loadInvoiceSettlements(this.prisma, 'purchaseInvoiceId', invoices),
    );
  }

  /**
   * R20 — the party's payment position per currency (customer / supplier
   * profile): open invoices and what they still owe (the same rows as the
   * open-invoices list), and the money its confirmed vouchers moved, split
   * into what settles invoices and what stays an unapplied advance. A
   * voucher's money is never read as "paid" unless it is allocated. R22 L2:
   * an agent-order collection is the agent's money, never the customer's.
   */
  async getPartyPosition(
    type: FinancialTransactionType,
    partyId: string,
  ): Promise<PartyPaymentPosition[]> {
    const [open, vouchers, settings] = await Promise.all([
      this.getOpenInvoices(type, partyId),
      this.prisma.financialTransaction.findMany({
        where: {
          type,
          partnerId: partyId,
          status: FinancialTransactionStatus.CONFIRMED,
          deletedAt: null,
          ...(type === 'CUSTOMER_RECEIPT' ? NOT_AGENT_COLLECTION : {}),
        },
        select: {
          amount: true,
          feeAmount: true,
          currencyId: true,
          currency: { select: { code: true } },
          allocations: {
            select: {
              allocatedAmount: true,
              salesInvoiceId: true,
              purchaseInvoiceId: true,
            },
          },
        },
      }),
      this.prisma.postingSettings.findFirst({
        select: {
          functionalCurrencyId: true,
          functionalCurrency: { select: { code: true } },
        },
      }),
    ]);
    const functional = {
      id: settings?.functionalCurrencyId ?? null,
      code: settings?.functionalCurrency?.code ?? null,
    };
    const byCurrency = new Map<string, PartyPaymentPosition>();
    const row = (currencyId: string | null, code: string | null) => {
      const id = currencyId ?? functional.id;
      const key = id ?? '';
      const existing = byCurrency.get(key);
      if (existing) return existing;
      const created: PartyPaymentPosition = {
        currencyId: id,
        currencyCode: currencyId ? code : functional.code,
        openInvoices: 0,
        outstanding: 0,
        received: 0,
        applied: 0,
        unapplied: 0,
      };
      byCurrency.set(key, created);
      return created;
    };
    for (const invoice of open) {
      const position = row(invoice.currencyId, invoice.currencyCode);
      position.openInvoices += 1;
      position.outstanding = this.round2(
        position.outstanding + invoice.remainingBalance,
      );
    }
    for (const voucher of vouchers) {
      const position = row(voucher.currencyId, voucher.currency?.code ?? null);
      const amount = Number(voucher.amount);
      const capacity = amount + Number(voucher.feeAmount ?? 0);
      const allLines = voucher.allocations.reduce(
        (sum, line) => sum + Number(line.allocatedAmount),
        0,
      );
      const toInvoices = voucher.allocations
        .filter((line) => line.salesInvoiceId || line.purchaseInvoiceId)
        .reduce((sum, line) => sum + Number(line.allocatedAmount), 0);
      position.received = this.round2(position.received + amount);
      position.applied = this.round2(position.applied + toInvoices);
      position.unapplied = this.round2(
        position.unapplied + Math.max(this.round2(capacity - allLines), 0),
      );
    }
    return [...byCurrency.values()].sort((a, b) =>
      (a.currencyCode ?? '').localeCompare(b.currencyCode ?? ''),
    );
  }

  private buildOpenInvoiceRows(
    invoices: {
      id: string;
      invoiceNumber: string;
      grandTotal: Prisma.Decimal;
      createdAt: Date;
      currencyId: string | null;
      currency: { code: string } | null;
    }[],
    settlements: Map<string, InvoicePaymentSummary>,
  ): OpenInvoiceRow[] {
    return invoices
      .map((invoice) => ({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        documentDate: invoice.createdAt.toISOString(),
        currencyId: invoice.currencyId,
        currencyCode: invoice.currency?.code ?? null,
        ...settlements.get(invoice.id)!,
      }))
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
      await this.assertExpenseAccount(dto.expenseAccountId);
      // Optional supplier counterparty — metadata only. Allocations never
      // apply to an Expense Payment Voucher, so the returned id is unused.
      if (dto.partnerId) {
        await this.partnersService.assertActiveForRole(
          dto.partnerId,
          PartnerRoleType.SUPPLIER,
        );
      }
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

  /**
   * R13 B2 — an Expense Payment Voucher debits an EXPENSE-type Posting
   * account that is not archived (Cleaning supplies → "Cleaning supplies
   * expense"), never a bank, payable or Group account.
   */
  private async assertExpenseAccount(expenseAccountId: string) {
    const account = await this.prisma.chartOfAccount.findFirst({
      where: { id: expenseAccountId, deletedAt: null },
      select: {
        code: true,
        name: true,
        accountType: true,
        allowsPosting: true,
      },
    });
    if (!account) {
      throw new BadRequestException({
        code: 'EXPENSE_ACCOUNT_INVALID',
        message: 'Expense account not found or archived.',
        fields: [{ field: 'expenseAccountId', constraints: ['not_found'] }],
      });
    }
    if (account.accountType !== 'EXPENSE') {
      throw new BadRequestException({
        code: 'EXPENSE_ACCOUNT_INVALID',
        message: `"${account.code} ${account.name}" is a ${account.accountType} account — an expense voucher must debit an Expense account.`,
        fields: [{ field: 'expenseAccountId', constraints: ['not_expense'] }],
      });
    }
    if (!account.allowsPosting) {
      throw new BadRequestException({
        code: 'EXPENSE_ACCOUNT_INVALID',
        message: `"${account.code} ${account.name}" is a Group account and cannot be posted to directly — choose a Posting expense account under it.`,
        fields: [{ field: 'expenseAccountId', constraints: ['group_account'] }],
      });
    }
  }

  /**
   * R13 (owner decision 2) — an expense voucher recognizes an expense
   * directly; it never settles a purchase invoice. Paying an invoice is a
   * Supplier Payment (Dr AP), so an invoiced cost is never expensed twice.
   */
  private assertNoExpenseAllocations(allocations: readonly unknown[]) {
    if (allocations.length === 0) return;
    throw new BadRequestException({
      code: 'EXPENSE_ALLOCATION_REFUSED',
      message:
        'An expense voucher never settles an invoice — pay a supplier invoice with a Supplier Payment instead.',
      fields: [{ field: 'allocations', constraints: ['not_allowed'] }],
    });
  }

  private assertAllocationsWithinAmount(
    amount: number,
    allocations: AllocationLineInput[],
    feeAmount = 0,
  ) {
    const total = this.round2(
      allocations.reduce((sum, a) => sum + a.allocatedAmount, 0),
    );
    const available = this.round2(amount + feeAmount);
    if (total - available > 0.005) {
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
    allocations: AllocationLineInput[],
    client: DbClient = this.prisma,
    /** CUSTOMER_REFUND — the refund's currency every refunded return must share. */
    refundCurrencyId: string | null = null,
    scope: {
      /** R22 L5 — the voucher's company: another company's invoice is refused. */
      companyId?: string | null;
      /** Allocate re-checks the balance itself under the invoice lock. */
      skipRemainingCheck?: boolean;
    } = {},
  ): Promise<
    Prisma.FinancialTransactionAllocationUncheckedCreateWithoutTransactionInput[]
  > {
    const resolved: Prisma.FinancialTransactionAllocationUncheckedCreateWithoutTransactionInput[] =
      [];
    const seenReturns = new Set<string>();
    const seenOrders = new Set<string>();
    const seenInvoices = new Set<string>();
    for (const allocation of allocations) {
      if (allocation.storeOrderId && type !== 'CUSTOMER_REFUND') {
        throw new BadRequestException(
          'Only a Customer Refund can pay back a store order advance — allocate this document to an invoice.',
        );
      }
      if (type === 'CUSTOMER_REFUND' && allocation.storeOrderId) {
        resolved.push(
          await this.resolveOrderAdvanceLine(
            partyId,
            allocation.storeOrderId,
            allocation.allocatedAmount,
            refundCurrencyId,
            seenOrders,
            client,
          ),
        );
        continue;
      }
      const invoiceId = allocation.invoiceId;
      if (!invoiceId) {
        throw new BadRequestException(
          'Every allocation line needs the document it settles.',
        );
      }
      if (type === 'CUSTOMER_REFUND') {
        const salesReturn = await client.salesReturn.findFirst({
          where: { id: invoiceId, deletedAt: null },
        });
        if (!salesReturn || salesReturn.partnerId !== partyId) {
          throw new BadRequestException(
            `المرتجع غير تابع لهذا العميل — Sales Return ${invoiceId} does not belong to this customer.`,
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
          where: { id: invoiceId, deletedAt: null },
        });
        if (!invoice || invoice.partnerId !== partyId) {
          throw new BadRequestException(
            `Invoice ${invoiceId} does not belong to this partner.`,
          );
        }
        // TASK-050 — a cancelled invoice can never receive a payment allocation.
        if (invoice.status === SalesDocumentStatus.CANCELLED) {
          throw new BadRequestException(
            `Cannot allocate a payment to cancelled Sales Invoice ${invoice.invoiceNumber}.`,
          );
        }
        this.assertPayableInvoice(
          PAYABLE_SALES_INVOICE_STATUSES.includes(invoice.status),
          `Sales Invoice ${invoice.invoiceNumber}`,
          invoice.status,
          seenInvoices,
          invoiceId,
        );
        resolved.push({
          salesInvoiceId: invoiceId,
          allocatedAmount: allocation.allocatedAmount,
        });
      } else {
        const invoice = await client.purchaseInvoice.findFirst({
          where: { id: invoiceId, deletedAt: null },
        });
        if (!invoice || invoice.partnerId !== partyId) {
          throw new BadRequestException(
            `Invoice ${invoiceId} does not belong to this partner.`,
          );
        }
        // TASK-050 — a cancelled invoice can never receive a payment allocation.
        if (invoice.status === PurchaseDocumentStatus.CANCELLED) {
          throw new BadRequestException(
            `Cannot allocate a payment to cancelled Purchase Invoice ${invoice.invoiceNumber}.`,
          );
        }
        this.assertPayableInvoice(
          PAYABLE_PURCHASE_INVOICE_STATUSES.includes(invoice.status),
          `Purchase Invoice ${invoice.invoiceNumber}`,
          invoice.status,
          seenInvoices,
          invoiceId,
        );
        resolved.push({
          purchaseInvoiceId: invoiceId,
          allocatedAmount: allocation.allocatedAmount,
        });
      }
    }
    const invoiceIds = resolved
      .map((line) => line.salesInvoiceId ?? line.purchaseInvoiceId)
      .filter((value): value is string => !!value);
    if (scope.companyId) {
      await this.assertInvoicesInCompany(
        client,
        type,
        scope.companyId,
        invoiceIds,
      );
    }
    // R22 L3 — a draft never claims more than an invoice owes (fail fast at
    // entry; re-checked under the invoice row lock at Confirm / Allocate).
    if (!scope.skipRemainingCheck) {
      for (const line of resolved) {
        const invoiceId = line.salesInvoiceId ?? line.purchaseInvoiceId;
        if (!invoiceId) continue;
        await this.assertAllocationWithinRemaining(
          type,
          invoiceId,
          Number(line.allocatedAmount),
          undefined,
          client,
        );
      }
    }
    return resolved;
  }

  /**
   * R20 — an allocation line settles a posted invoice, once per voucher. A
   * draft / pending / approved invoice owes nothing yet (record the money as
   * an unapplied advance and allocate it after Confirm); two lines on one
   * invoice would each pass its balance alone.
   */
  private assertPayableInvoice(
    posted: boolean,
    label: string,
    status: string,
    seenInvoices: Set<string>,
    invoiceId: string,
  ) {
    if (!posted) {
      throw new BadRequestException({
        code: 'INVOICE_NOT_POSTED',
        message: `الفاتورة غير مرحّلة — ${label} is ${status}: only a confirmed invoice can be paid. Confirm it first, or record the money as an unapplied advance.`,
      });
    }
    if (seenInvoices.has(invoiceId)) {
      throw new BadRequestException({
        code: 'DUPLICATE_ALLOCATION',
        message: `الفاتورة مكررة في التخصيص — ${label} appears more than once on this voucher; allocate it on one line.`,
      });
    }
    seenInvoices.add(invoiceId);
  }

  /**
   * R20 — the currency a receipt / supplier payment settles its invoices in.
   * Allocated amounts are invoice money (posting clears each at its invoice's
   * frozen rate), so a voucher only settles invoices of its own currency; a
   * voucher or invoice without a currency is in the functional currency
   * (Settings → Accounting). `requested` undefined = none chosen yet → the
   * invoices' (one) currency; null = the functional currency. Returns the
   * currency to store; refuses a mismatch with CURRENCY_MISMATCH.
   */
  private async settlementCurrency(
    type: FinancialTransactionType,
    requested: string | null | undefined,
    lines: readonly { invoiceId?: string }[],
    client: DbClient = this.prisma,
  ): Promise<string | undefined> {
    const keep = requested ?? undefined;
    if (type !== 'CUSTOMER_RECEIPT' && type !== 'SUPPLIER_PAYMENT') return keep;
    const invoiceIds = [
      ...new Set(
        lines
          .map((line) => line.invoiceId)
          .filter((value): value is string => !!value),
      ),
    ];
    if (invoiceIds.length === 0) return keep;
    const select = {
      invoiceNumber: true,
      currencyId: true,
      currency: { select: { code: true } },
    } as const;
    const invoices =
      type === 'CUSTOMER_RECEIPT'
        ? await client.salesInvoice.findMany({
            where: { id: { in: invoiceIds } },
            select,
          })
        : await client.purchaseInvoice.findMany({
            where: { id: { in: invoiceIds } },
            select,
          });
    const settings = await client.postingSettings.findFirst({
      select: {
        functionalCurrencyId: true,
        functionalCurrency: { select: { code: true } },
      },
    });
    const functionalId = settings?.functionalCurrencyId ?? null;
    const normalize = (currencyId: string | null) => currencyId ?? functionalId;
    const target =
      requested !== undefined
        ? normalize(requested)
        : normalize(invoices[0]?.currencyId ?? null);
    const voucherCode = async () => {
      if (target === functionalId) {
        return settings?.functionalCurrency?.code ?? 'functional';
      }
      const currency = target
        ? await client.currency.findUnique({
            where: { id: target },
            select: { code: true },
          })
        : null;
      return currency?.code ?? 'functional';
    };
    for (const invoice of invoices) {
      if (normalize(invoice.currencyId) === target) continue;
      const invoiceCode =
        invoice.currency?.code ??
        settings?.functionalCurrency?.code ??
        'functional';
      throw new BadRequestException({
        code: 'CURRENCY_MISMATCH',
        message:
          requested !== undefined
            ? `عملة السند تختلف عن عملة الفاتورة ${invoice.invoiceNumber} — This ${this.label(type).toLowerCase()} is in ${await voucherCode()} but invoice ${invoice.invoiceNumber} is in ${invoiceCode}; a voucher settles invoices of its own currency only.`
            : `الفواتير بعملات مختلفة — Invoice ${invoice.invoiceNumber} is in ${invoiceCode} and the other invoices are not; record one voucher per currency.`,
        fields: [{ field: 'currencyId', constraints: ['currency_mismatch'] }],
      });
    }
    return requested !== undefined
      ? keep
      : (invoices[0]?.currencyId ?? undefined);
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
      const [refunded, applied] = await Promise.all([
        this.sumConfirmedRefunds([invoiceId], client, excludeTransactionId),
        this.appliedCreditOfReturns(
          [salesReturn],
          client,
          excludeTransactionId,
        ),
      ]);
      // R22 F4 (D2) — only the surplus is refundable: the credit its own
      // invoice consumed settles that invoice and is never paid out again.
      const remaining = Math.max(
        this.round2(
          Number(salesReturn.grandTotal) -
            (refunded.get(invoiceId) ?? 0) -
            (applied.get(invoiceId) ?? 0),
        ),
        0,
      );
      if (amount > remaining + 0.005) {
        throw new BadRequestException({
          code: 'REFUND_EXCEEDS_RETURN_SURPLUS',
          message: `لا يمكن رد ${amount} — المتبقي القابل للرد على المرتجع ${salesReturn.returnNumber} هو ${remaining} فقط. — Cannot refund ${amount} against Sales Return ${salesReturn.returnNumber}: only ${remaining} of its credit is neither refunded nor applied to its invoice.`,
          details: {
            salesReturnId: invoiceId,
            refundable: remaining,
            appliedToInvoice: applied.get(invoiceId) ?? 0,
          },
        });
      }
      return;
    }
    const invoiceKey =
      type === 'CUSTOMER_RECEIPT' ? 'salesInvoiceId' : 'purchaseInvoiceId';
    const invoice =
      type === 'CUSTOMER_RECEIPT'
        ? await client.salesInvoice.findUniqueOrThrow({
            where: { id: invoiceId },
            select: { id: true, invoiceNumber: true, grandTotal: true },
          })
        : await client.purchaseInvoice.findUniqueOrThrow({
            where: { id: invoiceId },
            select: { id: true, invoiceNumber: true, grandTotal: true },
          });
    // R22 D2 — the one settlement summary: cash of the other confirmed
    // vouchers and the credit notes already settle part of the invoice.
    const summary = (
      await loadInvoiceSettlements(client, invoiceKey, [invoice], {
        excludeTransactionId,
      })
    ).get(invoice.id)!;
    if (amount > summary.remainingBalance + 0.005) {
      throw new BadRequestException({
        code: 'ALLOCATION_EXCEEDS_INVOICE_BALANCE',
        message: `لا يمكن تخصيص ${amount} للفاتورة ${invoice.invoiceNumber} — المتبقي ${summary.remainingBalance} فقط — Cannot allocate ${amount} to invoice ${invoice.invoiceNumber}: only ${summary.remainingBalance} remains unpaid${summary.creditedTotal > 0 ? ` (${summary.creditedTotal} settled by credit note)` : ''}.`,
        details: {
          invoiceId,
          remainingBalance: summary.remainingBalance,
          paidTotal: summary.paidTotal,
          creditedTotal: summary.creditedTotal,
        },
      });
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
    const [refunded, applied, balances] = await Promise.all([
      this.sumConfirmedRefunds(
        returns.map((r) => r.id),
        this.prisma,
      ),
      this.appliedCreditOfReturns(returns, this.prisma),
      partnerLedgerBalances(this.prisma, [
        ...new Set(returns.map((r) => r.partnerId)),
      ]),
    ]);
    return returns.map((salesReturn) => {
      const grandTotal = this.round2(Number(salesReturn.grandTotal));
      const refundedTotal = this.round2(refunded.get(salesReturn.id) ?? 0);
      // R22 F4 (D2) — the credit applied to its own invoice is not refundable.
      const unrefundedCredit = Math.max(
        this.round2(
          grandTotal - refundedTotal - (applied.get(salesReturn.id) ?? 0),
        ),
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

  /**
   * R22 D2 / F4 — per return: the part of its credit its own posted invoice
   * consumed (the invoice's `creditedTotal`, oldest return first). A refund
   * being confirmed is left out of the refunded side (`excludeTransactionId`).
   */
  private async appliedCreditOfReturns(
    returns: { id: string; salesInvoiceId: string | null }[],
    client: DbClient,
    excludeTransactionId?: string,
  ): Promise<Map<string, number>> {
    const invoiceIds = [
      ...new Set(
        returns
          .map((row) => row.salesInvoiceId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (invoiceIds.length === 0) return new Map();
    const invoices = await client.salesInvoice.findMany({
      where: {
        id: { in: invoiceIds },
        deletedAt: null,
        status: { in: PAYABLE_SALES_INVOICE_STATUSES },
      },
      select: { id: true, grandTotal: true },
    });
    const options = { excludeTransactionId };
    const [settlements, credits] = await Promise.all([
      loadInvoiceSettlements(client, 'salesInvoiceId', invoices, options),
      loadReturnCredits(
        client,
        'salesInvoiceId',
        invoices.map((invoice) => invoice.id),
        options,
      ),
    ]);
    return appliedCreditByReturn(
      credits,
      new Map(
        [...settlements].map(([id, summary]) => [id, summary.creditedTotal]),
      ),
    );
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

  /** A refund pays back exactly what it allocates to returns / order advances — never an unallocated payout. */
  private assertRefundFullyAllocated(
    amount: number,
    allocations: AllocationLineInput[],
  ) {
    if (
      allocations.length === 0 ||
      allocations.some((a) => !a.invoiceId === !a.storeOrderId)
    ) {
      throw new BadRequestException(
        'حدد المرتجع أو الطلب الذي يُرد مبلغه (واحد لكل سطر) — A Customer Refund must be allocated to the posted Sales Return(s) or store order advance(s) it pays back, exactly one per line.',
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
   * returns' / order advances' own rates — exactly what it will debit AR)
   * may not exceed the credit the customer actually holds on the posted
   * ledger. A return that only offset an unpaid invoice leaves nothing to
   * refund. The caller already holds the partner row lock (`lockPartnerRow`).
   */
  private async assertRefundWithinCustomerCredit(
    refund: {
      partnerId: string | null;
      transactionNumber: string;
      allocations: {
        salesReturnId: string | null;
        storeOrderId: string | null;
        allocatedAmount: unknown;
      }[];
    },
    tx: Prisma.TransactionClient,
  ) {
    if (!refund.partnerId) return;
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
    for (const allocation of refund.allocations) {
      if (!allocation.storeOrderId) continue;
      rates.set(
        allocation.storeOrderId,
        (await this.orderAdvanceRate(allocation.storeOrderId, tx)) ?? 1,
      );
    }
    const refundFunctional = this.round2(
      refund.allocations.reduce(
        (sum, a) =>
          sum +
          this.round2(
            Number(a.allocatedAmount) *
              (rates.get(a.salesReturnId ?? a.storeOrderId ?? '') ?? 1),
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

  /** The currency of the first refunded return / order — a refund's default currency. */
  private async firstRefundCurrency(
    allocations: AllocationLineInput[],
    client: DbClient = this.prisma,
  ): Promise<string | undefined> {
    const first = allocations[0];
    if (first?.storeOrderId) {
      const order = await client.storeOrder.findUnique({
        where: { id: first.storeOrderId },
        select: { currencyId: true },
      });
      return order?.currencyId ?? undefined;
    }
    if (!first?.invoiceId) return undefined;
    const salesReturn = await client.salesReturn.findFirst({
      where: { id: first.invoiceId, deletedAt: null },
      select: { currencyId: true },
    });
    return salesReturn?.currencyId ?? undefined;
  }

  /** A stored refund allocation as an input line (re-validation on update / confirm). */
  private refundLineOf(allocation: {
    salesReturnId: string | null;
    storeOrderId: string | null;
    allocatedAmount: unknown;
  }): AllocationLineInput {
    return {
      invoiceId: allocation.salesReturnId ?? undefined,
      storeOrderId: allocation.storeOrderId ?? undefined,
      allocatedAmount: Number(allocation.allocatedAmount),
    };
  }

  private async lockPartnerRow(
    tx: Prisma.TransactionClient,
    partnerId: string | null,
  ) {
    if (!partnerId) return;
    await tx.$queryRaw`
      SELECT id FROM partners WHERE id = ${partnerId}::uuid FOR UPDATE
    `;
  }

  /**
   * R15 (D15-11) — one refund line paying back a store order's advance: the
   * order belongs to the refund's customer, shares its currency, is a company
   * order (an agent order's collection credited the agent, never customer
   * AR — it is settled through the agent ledger) and appears once per
   * refund. The amount is checked against the order's refundable advance now
   * (fail fast) and again under the row locks at Confirm.
   */
  private async resolveOrderAdvanceLine(
    partyId: string,
    storeOrderId: string,
    amount: number,
    refundCurrencyId: string | null,
    seenOrders: Set<string>,
    client: DbClient,
  ): Promise<Prisma.FinancialTransactionAllocationUncheckedCreateWithoutTransactionInput> {
    const order = await client.storeOrder.findUnique({
      where: { id: storeOrderId },
      select: {
        id: true,
        internalOrderId: true,
        partnerId: true,
        currencyId: true,
        agentId: true,
      },
    });
    if (!order || order.partnerId !== partyId) {
      throw new BadRequestException(
        `الطلب غير تابع لهذا العميل — Store Order ${storeOrderId} does not belong to this customer.`,
      );
    }
    if (order.agentId) {
      throw new BadRequestException({
        code: 'AGENT_ORDER_REFUND_NOT_SUPPORTED',
        message: `طلب الوكيل ${order.internalOrderId} يُسوّى عبر حساب الوكيل وليس برد مبلغ للعميل — Agent order ${order.internalOrderId} is settled through the agent's ledger; its collections never credited the customer, so they are not refunded here.`,
      });
    }
    if (seenOrders.has(order.id)) {
      throw new BadRequestException(
        `الطلب ${order.internalOrderId} مكرر في الرد — Store Order ${order.internalOrderId} appears more than once on this refund.`,
      );
    }
    seenOrders.add(order.id);
    if (order.currencyId !== refundCurrencyId) {
      throw new BadRequestException(
        `عملة الرد يجب أن تطابق عملة الطلب ${order.internalOrderId} — The refund currency must match the currency of Store Order ${order.internalOrderId}.`,
      );
    }
    await this.assertAdvanceRefundWithin(order.id, amount, client);
    return { storeOrderId: order.id, allocatedAmount: amount };
  }

  /**
   * An advance line pays back only money actually collected for the order
   * beyond what the order still owes and beyond its returns' own credit
   * (that credit is refunded on return lines) — `advanceRefundable` of the
   * one shared order money position.
   */
  private async assertAdvanceRefundWithin(
    storeOrderId: string,
    amount: number,
    client: DbClient,
  ) {
    const position = await loadStoreOrderMoneyPosition(client, storeOrderId);
    if (!position) {
      throw new NotFoundException(`Store Order ${storeOrderId} not found`);
    }
    if (amount > position.advanceRefundable + 0.005) {
      throw new BadRequestException({
        code: 'REFUND_EXCEEDS_ORDER_ADVANCE',
        message: `لا يمكن رد ${amount} على الطلب ${position.internalOrderId} — المتاح للرد ${position.advanceRefundable} فقط (المحصّل ${position.collected}، المستحق ${position.expected}، المردود ${position.refunded}). — Cannot refund ${amount} against Store Order ${position.internalOrderId}: only ${position.advanceRefundable} of its collected money is refundable (collected ${position.collected}, owed ${position.expected}, already refunded ${position.refunded}).`,
        details: {
          storeOrderId,
          advanceRefundable: position.advanceRefundable,
          refundDue: position.refundDue,
        },
      });
    }
  }

  /** Rate at which the order's advance credited AR (see `advanceRateOf`). */
  private async orderAdvanceRate(storeOrderId: string, client: DbClient) {
    const position = await loadStoreOrderMoneyPosition(client, storeOrderId);
    return position ? advanceRateOf(position.receipts) : null;
  }

  /** A confirmed refund's allocation is its whole meaning — fixed once posted. */
  private assertAllocationsEditable(transaction: {
    type: FinancialTransactionType;
    transactionNumber: string;
  }) {
    if (transaction.type === 'EXPENSE_PAYMENT') {
      this.assertNoExpenseAllocations([{}]);
    }
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
