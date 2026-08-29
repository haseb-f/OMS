import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BankTransactionMatchStatus,
  CashFlowDirection,
  CashFlowOutgoingType,
  PaymentStatus,
  Prisma,
  SalesDocumentStatus,
  PurchaseDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentAutoMatchingService } from '../payments/auto-matching/payment-auto-matching.service';
import { PaymentsService } from '../payments/payments.service';
import { StoreOrdersService } from '../store-orders/store-orders.service';
import { StoreOrderPaymentSyncService } from '../store-orders/store-order-payment-sync.service';
import { FinancialTransactionsService } from '../financial-transactions/financial-transactions.service';
import type { CompanyContext } from '../common/decorators/current-company-context.decorator';

export interface ReconciliationCandidate {
  kind: 'PAYMENT' | 'STORE_ORDER' | 'SALES_INVOICE' | 'PURCHASE_INVOICE';
  id: string;
  label: string;
  amount: number;
  score: number;
  reasons: string[];
}

/**
 * Cash Flow reconciliation (spec sections 5-11) — the layer above
 * `BankTransactionsService`'s legacy COD-Payment matching. Deliberately
 * never creates a second payment/posting engine: every confirm method
 * below is a thin orchestration that calls the ALREADY-EXISTING business
 * operation for its target (`StoreOrdersService.addPayment` +
 * `PaymentsService.match`, or `FinancialTransactionsService.create` +
 * `.confirm()`, which itself calls the Posting Engine) and then stamps the
 * `BankTransaction` row with whichever `matched*Id` field proves it. Every
 * confirm method checks that field first — the idempotency guarantee
 * against a duplicate confirm/re-sync (spec section 4/20).
 */
@Injectable()
export class CashFlowReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autoMatching: PaymentAutoMatchingService,
    private readonly paymentsService: PaymentsService,
    private readonly storeOrdersService: StoreOrdersService,
    private readonly storeOrderPaymentSync: StoreOrderPaymentSyncService,
    private readonly financialTransactions: FinancialTransactionsService,
  ) {}

  private async getUnreconciled(
    id: string,
    expectedDirection?: CashFlowDirection,
  ) {
    const transaction = await this.prisma.bankTransaction.findFirst({
      where: { id, deletedAt: null },
    });
    if (!transaction) {
      throw new BadRequestException(`Cash Flow transaction ${id} not found.`);
    }
    if (
      transaction.matchedPaymentId ||
      transaction.matchedFinancialTransactionId
    ) {
      throw new BadRequestException(
        'This transaction is already reconciled — never re-reconciled from here.',
      );
    }
    if (
      expectedDirection &&
      transaction.direction &&
      transaction.direction !== expectedDirection
    ) {
      throw new BadRequestException(
        `This transaction is classified ${transaction.direction}, not ${expectedDirection}.`,
      );
    }
    return transaction;
  }

  // ---------------------------------------------------------------------
  // INCOMING — suggestion
  // ---------------------------------------------------------------------

  /**
   * Read-only — never writes a match itself (spec: "Never match solely on
   * a weak identifier when ambiguity exists. Ambiguous transactions must go
   * to review"). Merges three candidate pools: existing PENDING `Payment`
   * rows (the legacy COD path, reused via `PaymentAutoMatchingService`
   * unchanged), open Store Orders matched by External Order ID, and open
   * B2B Sales Invoices matched by invoice number — never phone number
   * (explicitly forbidden by the spec).
   */
  async suggestIncoming(id: string): Promise<{
    status: BankTransactionMatchStatus;
    candidates: ReconciliationCandidate[];
  }> {
    const transaction = await this.getUnreconciled(
      id,
      CashFlowDirection.INCOMING,
    );
    const amount = Math.abs(Number(transaction.amount));
    const needle =
      `${transaction.reference ?? ''} ${transaction.description ?? ''}`
        .trim()
        .toLowerCase();

    const candidates: ReconciliationCandidate[] = [];

    // Legacy COD Payment pool — same scorer as PaymentAutoMatchingService,
    // never a second one.
    const paymentClassification = await this.autoMatching.classify(id);
    for (const candidate of paymentClassification.candidates) {
      candidates.push({
        kind: 'PAYMENT',
        id: candidate.paymentId,
        label: candidate.paymentNumber,
        amount,
        score: candidate.score,
        reasons: candidate.reasons,
      });
    }

    // Store Orders — External Order ID appearing in the transaction's own
    // reference/description, amount within tolerance, order not yet fully
    // reconciled.
    if (needle) {
      const openOrders = await this.prisma.storeOrder.findMany({
        where: {
          deletedAt: null,
          externalOrderId: { not: null },
          paymentStatus: {
            in: ['PAYMENT_PENDING', 'PARTIALLY_PAID', 'PAYMENT_REVIEW'],
          },
        },
        select: {
          id: true,
          internalOrderId: true,
          externalOrderId: true,
          currencyId: true,
        },
        take: 500,
      });
      for (const order of openOrders) {
        if (!order.externalOrderId) continue;
        if (!needle.includes(order.externalOrderId.toLowerCase())) continue;
        if (
          transaction.currencyId &&
          order.currencyId &&
          transaction.currencyId !== order.currencyId
        ) {
          continue;
        }
        candidates.push({
          kind: 'STORE_ORDER',
          id: order.id,
          label: `${order.internalOrderId} (${order.externalOrderId})`,
          amount,
          score: 70,
          reasons: [
            `External Order ID "${order.externalOrderId}" found in reference/description`,
          ],
        });
      }
    }

    // B2B Sales Invoices — invoice number appearing in the transaction's
    // reference/description, CONFIRMED, remaining balance > 0.
    if (needle) {
      const openInvoices = await this.prisma.salesInvoice.findMany({
        where: {
          deletedAt: null,
          status: SalesDocumentStatus.CONFIRMED,
          storeOrderId: null,
        },
        select: {
          id: true,
          invoiceNumber: true,
          grandTotal: true,
          partnerId: true,
          currencyId: true,
        },
        take: 500,
      });
      for (const invoice of openInvoices) {
        if (!needle.includes(invoice.invoiceNumber.toLowerCase())) continue;
        if (
          transaction.currencyId &&
          invoice.currencyId &&
          transaction.currencyId !== invoice.currencyId
        ) {
          continue;
        }
        candidates.push({
          kind: 'SALES_INVOICE',
          id: invoice.id,
          label: invoice.invoiceNumber,
          amount,
          score: 70,
          reasons: [
            `Invoice number "${invoice.invoiceNumber}" found in reference/description`,
          ],
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const status = this.classifyFromCandidates(candidates);
    await this.prisma.bankTransaction.update({
      where: { id },
      data: {
        matchStatus: status,
        matchCandidates: candidates as unknown as Prisma.InputJsonValue,
      },
    });
    return { status, candidates };
  }

  private classifyFromCandidates(
    candidates: ReconciliationCandidate[],
  ): BankTransactionMatchStatus {
    if (candidates.length === 0) return BankTransactionMatchStatus.UNMATCHED;
    const [top, second] = candidates;
    if (second && second.score === top.score) {
      // Tied top candidates — genuinely ambiguous, never guessed.
      return BankTransactionMatchStatus.MANUAL_REVIEW;
    }
    return BankTransactionMatchStatus.POTENTIAL;
  }

  // ---------------------------------------------------------------------
  // INCOMING — Store Orders (spec section 6)
  // ---------------------------------------------------------------------

  /**
   * Creates (never re-creates — idempotency via `getUnreconciled`'s guard)
   * a real `Payment` against the given Store Order via the EXISTING
   * `StoreOrdersService.addPayment`, then reuses the existing manual "Match
   * Payment" operation (`PaymentsService.match`) — the same two calls
   * `BankTransactionsService.confirmMatch` already makes for a pre-created
   * COD Payment, just with the Payment created fresh here instead of
   * pre-existing. Verification (PENDING->MATCHED->VERIFIED) stays a
   * separate, still-manual step — this never bypasses that existing
   * control (spec section 16).
   */
  async confirmStoreOrderPayment(
    id: string,
    dto: {
      storeOrderId: string;
      paymentSourceId: string;
      referenceNumber?: string;
      senderName?: string;
    },
    userId: string,
  ) {
    const transaction = await this.getUnreconciled(
      id,
      CashFlowDirection.INCOMING,
    );
    const receivingAccountId = transaction.cashSourceId;
    if (!receivingAccountId) {
      throw new BadRequestException(
        'This transaction has no mapped Cash Source — map it to a Receiving Account before reconciling.',
      );
    }

    const payment = await this.storeOrdersService.addPayment(
      dto.storeOrderId,
      {
        paymentDate: transaction.transactionDate.toISOString(),
        amount: Math.abs(Number(transaction.amount)),
        currencyId: transaction.currencyId ?? undefined,
        paymentSourceId: dto.paymentSourceId,
        receivingAccountId,
        referenceNumber:
          dto.referenceNumber ??
          transaction.transactionId ??
          transaction.reference ??
          undefined,
        senderName:
          dto.senderName ||
          transaction.description ||
          transaction.reference ||
          transaction.bankName ||
          'Cash Flow Sync',
      },
      userId,
    );
    await this.paymentsService.match(payment.id, { matchedById: userId });

    return this.prisma.bankTransaction.update({
      where: { id },
      data: {
        direction: CashFlowDirection.INCOMING,
        matchStatus: BankTransactionMatchStatus.MATCHED,
        matchedPaymentId: payment.id,
        matchedAt: new Date(),
        matchedById: userId,
      },
    });
  }

  // ---------------------------------------------------------------------
  // INCOMING — B2B Sales Invoices (spec section 7)
  // ---------------------------------------------------------------------

  /**
   * Reuses the existing Customer Receipt mechanism end to end
   * (`FinancialTransactionsService.create('CUSTOMER_RECEIPT', ...)` +
   * `.confirm()`, which posts via the Posting Engine automatically) —
   * never a second B2B payment concept. Supports one payment covering
   * multiple invoices (the `allocations` array), full or partial per
   * invoice — the existing `assertAllocationWithinRemaining` guard already
   * enforces "never over-allocate".
   */
  async confirmSalesInvoiceReceipt(
    id: string,
    dto: {
      allocations: { invoiceId: string; allocatedAmount: number }[];
      paymentSourceId?: string;
    },
    userId: string,
    context: CompanyContext,
  ) {
    const transaction = await this.getUnreconciled(
      id,
      CashFlowDirection.INCOMING,
    );
    if (dto.allocations.length === 0) {
      throw new BadRequestException(
        'At least one invoice allocation is required.',
      );
    }
    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        id: { in: dto.allocations.map((a) => a.invoiceId) },
        deletedAt: null,
      },
      select: { id: true, partnerId: true },
    });
    const partnerIds = new Set(invoices.map((i) => i.partnerId));
    if (partnerIds.size !== 1) {
      throw new BadRequestException(
        'All allocated invoices must belong to the same partner.',
      );
    }
    const [partnerId] = partnerIds;

    const created = await this.financialTransactions.create(
      'CUSTOMER_RECEIPT',
      {
        partnerId,
        currencyId: transaction.currencyId ?? undefined,
        transactionDate: transaction.transactionDate.toISOString(),
        paymentSourceId: dto.paymentSourceId,
        receivingAccountId: transaction.cashSourceId ?? undefined,
        amount: Math.abs(Number(transaction.amount)),
        referenceNumber:
          transaction.transactionId ?? transaction.reference ?? undefined,
        notes: transaction.description ?? undefined,
        allocations: dto.allocations,
      },
      userId,
      context,
    );
    await this.financialTransactions.confirm(created.id, userId);

    return this.prisma.bankTransaction.update({
      where: { id },
      data: {
        direction: CashFlowDirection.INCOMING,
        matchStatus: BankTransactionMatchStatus.MATCHED,
        matchedFinancialTransactionId: created.id,
        matchedAt: new Date(),
        matchedById: userId,
      },
    });
  }

  // ---------------------------------------------------------------------
  // OUTGOING — classification (spec section 9/12)
  // ---------------------------------------------------------------------

  /** Sets/corrects the outgoing classification hints — never itself a reconciliation, just what a human (or the sheet's own columns) declares this row to be before choosing a confirm path. */
  async classifyOutgoing(
    id: string,
    dto: {
      outgoingType: CashFlowOutgoingType;
      expenseAccountId?: string;
      partnerId?: string;
      costCenterId?: string;
      projectId?: string;
    },
  ) {
    await this.getUnreconciled(id, CashFlowDirection.OUTGOING);
    if (
      dto.outgoingType === CashFlowOutgoingType.EXPENSE &&
      !dto.expenseAccountId
    ) {
      throw new BadRequestException(
        'expenseAccountId is required to classify as Expense.',
      );
    }
    if (
      dto.outgoingType === CashFlowOutgoingType.SUPPLIER_PAYMENT &&
      !dto.partnerId
    ) {
      throw new BadRequestException(
        'partnerId is required to classify as Supplier Payment.',
      );
    }
    return this.prisma.bankTransaction.update({
      where: { id },
      data: {
        direction: CashFlowDirection.OUTGOING,
        outgoingType: dto.outgoingType,
        expenseAccountId:
          dto.outgoingType === CashFlowOutgoingType.EXPENSE
            ? dto.expenseAccountId
            : null,
        partnerId:
          dto.outgoingType === CashFlowOutgoingType.SUPPLIER_PAYMENT
            ? dto.partnerId
            : null,
        costCenterId: dto.costCenterId,
        projectId: dto.projectId,
      },
    });
  }

  /** Suggests Purchase Invoice candidates for an OUTGOING/SUPPLIER_PAYMENT row — same "match on a reliable identifier, never guess" rule as `suggestIncoming`. */
  async suggestOutgoing(id: string): Promise<{
    status: BankTransactionMatchStatus;
    candidates: ReconciliationCandidate[];
  }> {
    const transaction = await this.getUnreconciled(
      id,
      CashFlowDirection.OUTGOING,
    );
    if (transaction.outgoingType !== CashFlowOutgoingType.SUPPLIER_PAYMENT) {
      return { status: transaction.matchStatus, candidates: [] };
    }
    const amount = Math.abs(Number(transaction.amount));
    const needle =
      `${transaction.reference ?? ''} ${transaction.description ?? ''}`
        .trim()
        .toLowerCase();

    const candidates: ReconciliationCandidate[] = [];
    const openInvoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        deletedAt: null,
        status: PurchaseDocumentStatus.CONFIRMED,
        ...(transaction.partnerId ? { partnerId: transaction.partnerId } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        grandTotal: true,
        partnerId: true,
        currencyId: true,
      },
      take: 500,
    });
    for (const invoice of openInvoices) {
      const referenceMatches =
        needle && needle.includes(invoice.invoiceNumber.toLowerCase());
      const partnerMatches = transaction.partnerId === invoice.partnerId;
      if (!referenceMatches && !partnerMatches) continue;
      if (
        transaction.currencyId &&
        invoice.currencyId &&
        transaction.currencyId !== invoice.currencyId
      ) {
        continue;
      }
      candidates.push({
        kind: 'PURCHASE_INVOICE',
        id: invoice.id,
        label: invoice.invoiceNumber,
        amount,
        score: referenceMatches ? 70 : 40,
        reasons: [
          ...(referenceMatches
            ? [
                `Invoice number "${invoice.invoiceNumber}" found in reference/description`,
              ]
            : []),
          ...(partnerMatches ? ['Matches the classified Partner'] : []),
        ],
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const status = this.classifyFromCandidates(candidates);
    await this.prisma.bankTransaction.update({
      where: { id },
      data: {
        matchStatus: status,
        matchCandidates: candidates as unknown as Prisma.InputJsonValue,
      },
    });
    return { status, candidates };
  }

  // ---------------------------------------------------------------------
  // OUTGOING — Supplier Payment (spec section 10)
  // ---------------------------------------------------------------------

  /** Reuses the existing Supplier Payment Voucher mechanism end to end — same as `confirmSalesInvoiceReceipt` mirrored for `SUPPLIER_PAYMENT`. */
  async confirmPurchaseInvoicePayment(
    id: string,
    dto: {
      allocations: { invoiceId: string; allocatedAmount: number }[];
      paymentSourceId?: string;
    },
    userId: string,
    context: CompanyContext,
  ) {
    const transaction = await this.getUnreconciled(
      id,
      CashFlowDirection.OUTGOING,
    );
    if (dto.allocations.length === 0) {
      throw new BadRequestException(
        'At least one invoice allocation is required.',
      );
    }
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        id: { in: dto.allocations.map((a) => a.invoiceId) },
        deletedAt: null,
      },
      select: { id: true, partnerId: true },
    });
    const partnerIds = new Set(invoices.map((i) => i.partnerId));
    if (partnerIds.size !== 1) {
      throw new BadRequestException(
        'All allocated invoices must belong to the same partner.',
      );
    }
    const [partnerId] = partnerIds;

    const created = await this.financialTransactions.create(
      'SUPPLIER_PAYMENT',
      {
        partnerId,
        currencyId: transaction.currencyId ?? undefined,
        transactionDate: transaction.transactionDate.toISOString(),
        paymentSourceId: dto.paymentSourceId,
        receivingAccountId: transaction.cashSourceId ?? undefined,
        amount: Math.abs(Number(transaction.amount)),
        referenceNumber:
          transaction.transactionId ?? transaction.reference ?? undefined,
        notes: transaction.description ?? undefined,
        allocations: dto.allocations,
      },
      userId,
      context,
    );
    await this.financialTransactions.confirm(created.id, userId);

    return this.prisma.bankTransaction.update({
      where: { id },
      data: {
        direction: CashFlowDirection.OUTGOING,
        outgoingType: CashFlowOutgoingType.SUPPLIER_PAYMENT,
        matchStatus: BankTransactionMatchStatus.MATCHED,
        matchedFinancialTransactionId: created.id,
        matchedAt: new Date(),
        matchedById: userId,
      },
    });
  }

  // ---------------------------------------------------------------------
  // OUTGOING — Expense (spec section 11/12) — "Auto Payment Voucher"
  // ---------------------------------------------------------------------

  /**
   * The one path from "outgoing row" straight to a Payment Voucher, no
   * invoice reconciliation involved (spec: "DO NOT send it through invoice
   * reconciliation"). Reuses the row's own classification hints
   * (`expenseAccountId`/`costCenterId`/`projectId`, usually set at import
   * time from the sheet's own columns) as defaults, overridable per the
   * "manual classification/correction" requirement (spec section 16).
   */
  async confirmExpenseVoucher(
    id: string,
    dto: {
      expenseAccountId?: string;
      costCenterId?: string;
      projectId?: string;
      paymentSourceId?: string;
    },
    userId: string,
    context: CompanyContext,
  ) {
    const transaction = await this.getUnreconciled(
      id,
      CashFlowDirection.OUTGOING,
    );
    const expenseAccountId =
      dto.expenseAccountId ?? transaction.expenseAccountId;
    if (!expenseAccountId) {
      throw new BadRequestException(
        'expenseAccountId is required — this row has no Expense account classified yet.',
      );
    }

    const created = await this.financialTransactions.create(
      'EXPENSE_PAYMENT',
      {
        expenseAccountId,
        currencyId: transaction.currencyId ?? undefined,
        costCenterId: dto.costCenterId ?? transaction.costCenterId ?? undefined,
        projectId: dto.projectId ?? transaction.projectId ?? undefined,
        transactionDate: transaction.transactionDate.toISOString(),
        paymentSourceId: dto.paymentSourceId,
        receivingAccountId: transaction.cashSourceId ?? undefined,
        amount: Math.abs(Number(transaction.amount)),
        referenceNumber:
          transaction.transactionId ?? transaction.reference ?? undefined,
        notes: transaction.description ?? undefined,
      },
      userId,
      context,
    );
    await this.financialTransactions.confirm(created.id, userId);

    return this.prisma.bankTransaction.update({
      where: { id },
      data: {
        direction: CashFlowDirection.OUTGOING,
        outgoingType: CashFlowOutgoingType.EXPENSE,
        expenseAccountId,
        matchStatus: BankTransactionMatchStatus.MATCHED,
        matchedFinancialTransactionId: created.id,
        matchedAt: new Date(),
        matchedById: userId,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Bulk (spec section 17) — partial success, per-row try/catch, same
  // pattern as ImportJobsService.confirmRows/rejectRows.
  // ---------------------------------------------------------------------

  async bulkConfirmExpenseVouchers(
    ids: string[],
    userId: string,
    context: CompanyContext,
  ): Promise<{ id: string; success: boolean; message?: string }[]> {
    const results: { id: string; success: boolean; message?: string }[] = [];
    for (const id of ids) {
      try {
        await this.confirmExpenseVoucher(id, {}, userId, context);
        results.push({ id, success: true });
      } catch (error) {
        results.push({
          id,
          success: false,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to create voucher.',
        });
      }
    }
    return results;
  }

  async bulkClassifyOutgoing(
    ids: string[],
    dto: {
      outgoingType: CashFlowOutgoingType;
      expenseAccountId?: string;
      partnerId?: string;
    },
  ): Promise<{ id: string; success: boolean; message?: string }[]> {
    const results: { id: string; success: boolean; message?: string }[] = [];
    for (const id of ids) {
      try {
        await this.classifyOutgoing(id, dto);
        results.push({ id, success: true });
      } catch (error) {
        results.push({
          id,
          success: false,
          message:
            error instanceof Error ? error.message : 'Failed to classify.',
        });
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------
  // Reporting (spec section 23)
  // ---------------------------------------------------------------------

  async getSummary() {
    const [incomingByStatus, outgoingByType, outgoingByStatus] =
      await Promise.all([
        this.prisma.bankTransaction.groupBy({
          by: ['matchStatus'],
          where: { deletedAt: null, direction: CashFlowDirection.INCOMING },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        this.prisma.bankTransaction.groupBy({
          by: ['outgoingType'],
          where: { deletedAt: null, direction: CashFlowDirection.OUTGOING },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        this.prisma.bankTransaction.groupBy({
          by: ['matchStatus'],
          where: { deletedAt: null, direction: CashFlowDirection.OUTGOING },
          _count: { _all: true },
          _sum: { amount: true },
        }),
      ]);

    const incomingMatchedCount = incomingByStatus
      .filter((r) => r.matchStatus === BankTransactionMatchStatus.MATCHED)
      .reduce((sum, r) => sum + r._count._all, 0);
    const [storeOrderMatches, b2bMatches] = await Promise.all([
      this.prisma.bankTransaction.count({
        where: {
          deletedAt: null,
          direction: CashFlowDirection.INCOMING,
          matchedPaymentId: { not: null },
        },
      }),
      this.prisma.bankTransaction.count({
        where: {
          deletedAt: null,
          direction: CashFlowDirection.INCOMING,
          matchedFinancialTransactionId: { not: null },
        },
      }),
    ]);

    return {
      incoming: {
        total: incomingByStatus.reduce((sum, r) => sum + r._count._all, 0),
        matched: incomingMatchedCount,
        partiallyMatched:
          incomingByStatus.find((r) => r.matchStatus === 'PARTIALLY_MATCHED')
            ?._count._all ?? 0,
        unmatched:
          incomingByStatus.find((r) => r.matchStatus === 'UNMATCHED')?._count
            ._all ?? 0,
        conflicts:
          incomingByStatus.find((r) => r.matchStatus === 'CONFLICT')?._count
            ._all ?? 0,
        storeOrderMatches,
        b2bSalesInvoiceMatches: b2bMatches,
      },
      outgoing: {
        total: outgoingByStatus.reduce((sum, r) => sum + r._count._all, 0),
        supplierPayments:
          outgoingByType.find((r) => r.outgoingType === 'SUPPLIER_PAYMENT')
            ?._count._all ?? 0,
        expenses:
          outgoingByType.find((r) => r.outgoingType === 'EXPENSE')?._count
            ._all ?? 0,
        unclassified:
          outgoingByType.find((r) => r.outgoingType === null)?._count._all ?? 0,
        pendingVoucher: outgoingByStatus
          .filter(
            (r) =>
              r.matchStatus === 'UNMATCHED' || r.matchStatus === 'POTENTIAL',
          )
          .reduce((sum, r) => sum + r._count._all, 0),
        posted:
          outgoingByStatus.find((r) => r.matchStatus === 'MATCHED')?._count
            ._all ?? 0,
        conflicts:
          outgoingByStatus.find((r) => r.matchStatus === 'CONFLICT')?._count
            ._all ?? 0,
      },
    };
  }

  /**
   * Controlled Unreconcile — clears the Cash Flow match without deleting the
   * bank transaction. Soft-deletes the linked Store Order Payment (so it no
   * longer contributes to order PAID truth) and recomputes paymentStatus.
   * B2B financial-transaction matches that already posted must be reversed
   * through the financial document flow — not silently cleared here.
   */
  async unreconcile(id: string, userId: string, reason?: string) {
    const transaction = await this.prisma.bankTransaction.findFirst({
      where: { id, deletedAt: null },
    });
    if (!transaction) {
      throw new BadRequestException(`Cash Flow transaction ${id} not found.`);
    }
    if (
      !transaction.matchedPaymentId &&
      !transaction.matchedFinancialTransactionId
    ) {
      throw new BadRequestException(
        'This transaction is not reconciled — nothing to unreconcile.',
      );
    }
    if (transaction.matchedFinancialTransactionId) {
      throw new BadRequestException(
        'B2B / posted financial reconciliations must be reversed via the financial document — not Cash Flow unreconcile.',
      );
    }

    const paymentId = transaction.matchedPaymentId!;
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
    });
    if (!payment) {
      throw new BadRequestException(
        'Linked payment is missing — clear the Cash Flow match manually after review.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          deletedAt: new Date(),
          updatedBy: userId,
          status: PaymentStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedById: userId,
          rejectionReason:
            reason?.trim() ||
            'Unreconciled from Cash Flow — allocation reversed',
        },
      });
      await tx.paymentActivity.create({
        data: {
          paymentId,
          type: 'UNRECONCILED',
          description:
            reason?.trim() ||
            `Unreconciled from Cash Flow transaction ${transaction.transactionId ?? id}`,
          metadata: {
            bankTransactionId: id,
            previousStatus: payment.status,
            performedById: userId,
          },
        },
      });
      await tx.bankTransaction.update({
        where: { id },
        data: {
          matchStatus: BankTransactionMatchStatus.UNMATCHED,
          matchedPaymentId: null,
          matchedAt: null,
          matchedById: null,
          matchCandidates: Prisma.DbNull,
        },
      });
    });

    if (payment.storeOrderId) {
      await this.storeOrderPaymentSync.recompute(payment.storeOrderId);
    }

    return this.prisma.bankTransaction.findFirstOrThrow({
      where: { id },
    });
  }
}
