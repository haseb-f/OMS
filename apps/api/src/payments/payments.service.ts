import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AccountType,
  PaymentMatchStatus,
  PaymentSettlementStatus,
  PaymentStatus,
  Prisma,
  type Payment,
} from '@prisma/client';
import {
  ExchangeRatesService,
  type ResolvedRate,
} from '../accounting/fx/exchange-rates.service';
import {
  flagDiscrepancyIfFulfilled,
  recomputeDeclaredPaymentStatus,
} from '../store-orders/payment-declaration/payment-declaration.core';
import { assertCompanyCashClaim } from '../agents/finance/agent-payment-scope';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { StoreOrderPaymentSyncService } from '../store-orders/store-order-payment-sync.service';
import {
  StoreOrderCollectionService,
  type MethodReceiptOverride,
  type PostedPaymentReceipt,
} from '../accounting/store-order-collection/store-order-collection.service';
import {
  PaymentActivityService,
  PaymentActivityType,
} from './activities/payment-activity.service';
import { PaymentNotesService } from './notes/payment-notes.service';
import { AgentCollectionHooksService } from '../agents/finance/agent-collection-hooks.service';
import { PaymentAttachmentsService } from './attachments/payment-attachments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreatePaymentNoteDto } from './dto/create-payment-note.dto';
import { CreatePaymentAttachmentDto } from './dto/create-payment-attachment.dto';
import { MatchPaymentDto } from './dto/match-payment.dto';
import { RejectPaymentDto } from './dto/reject-payment.dto';
import { FindPaymentsQueryDto } from './dto/find-payments-query.dto';
import {
  assertCanVerifyPayment,
  assertPaymentCurrency,
  computeStoreOrderSettlement,
  lockStoreOrderRow,
  verifiedPaymentNumbers,
} from '../store-orders/store-order-payment-settlement.util';

export interface ConfirmClaimOptions {
  /** FX + JE date; defaults to the payment's actual date (e.g. the matched statement date for reconciled methods). */
  rateAsOf?: Date;
  /** Provenance only (reconciliation), recorded on the activity log. */
  statementLineId?: string;
}

export interface ConfirmInTxResult {
  payment: Payment;
  receiptId: string;
  receipt: PostedPaymentReceipt;
  alreadyPosted: boolean;
}

/** UTC midnight of the date's calendar day (FinancialTransaction.rateAsOf is a DATE). */
function toDateOnly(value: Date): Date {
  const d = new Date(value);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** Frozen provenance, e.g. `CBE:<rateId>`, `OVERRIDE:<overrideId>`, `IDENTITY`. */
function describeRateSource(resolved: ResolvedRate): string {
  const ref = resolved.overrideId ?? resolved.rateId;
  return ref ? `${resolved.source}:${ref}` : resolved.source;
}

export interface PaymentConfirmResult {
  id: string;
  paymentNumber: string;
  status: PaymentStatus;
  /** True when this call found the receipt already posted (a retry). */
  alreadyPosted: boolean;
  receipt: PostedPaymentReceipt;
}

/**
 * Payment Workflow: Customer sends payment -> Payment record created ->
 * Accounting reviews bank statement manually -> Accounting matches payment
 * -> Payment becomes VERIFIED -> Store Order payment status is recomputed.
 * Matching is manual only in this phase — see PaymentAutoMatchingService
 * for the (unused) architecture placeholder.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: PaymentActivityService,
    private readonly notesService: PaymentNotesService,
    private readonly attachmentsService: PaymentAttachmentsService,
    private readonly numberingEngine: NumberingEngineService,
    private readonly storeOrderPaymentSync: StoreOrderPaymentSyncService,
    private readonly storeOrderCollection: StoreOrderCollectionService,
    private readonly exchangeRates: ExchangeRatesService,
    private readonly agentCollections: AgentCollectionHooksService,
  ) {}

  /** Business operation: Create Payment. Must reference BOTH a PaymentSource (how the
   *  customer paid) and a ReceivingAccount (where the money arrived) — never only one. */
  async create(dto: CreatePaymentDto) {
    const paymentSource = await this.prisma.paymentSource.findFirst({
      where: { id: dto.paymentSourceId, deletedAt: null, isActive: true },
    });
    if (!paymentSource) {
      throw new BadRequestException(
        'Payment source not found or is not active.',
      );
    }

    const receivingAccount = await this.prisma.receivingAccount.findFirst({
      where: { id: dto.receivingAccountId, deletedAt: null, isActive: true },
    });
    if (!receivingAccount) {
      throw new BadRequestException(
        'Receiving account not found or is not active.',
      );
    }

    const paymentNumber = await this.numberingEngine.generateNumber('PAYMENT');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            paymentNumber,
            leadId: dto.leadId,
            paymentDate: new Date(dto.paymentDate),
            receivedDate: dto.receivedDate
              ? new Date(dto.receivedDate)
              : undefined,
            amount: dto.amount,
            currencyId: dto.currencyId,
            paymentSourceId: dto.paymentSourceId,
            receivingAccountId: dto.receivingAccountId,
            referenceNumber: dto.referenceNumber,
            senderName: dto.senderName,
            bankAccount: dto.bankAccount,
            status: PaymentStatus.PENDING,
          },
        });
        await this.activityService.log(
          payment.id,
          PaymentActivityType.PAYMENT_CREATED,
          `Payment ${payment.paymentNumber} created`,
          { leadId: dto.leadId },
          tx,
        );
        return payment;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException('Invalid lead or currency reference.');
      }
      throw error;
    }
  }

  findAll(query?: FindPaymentsQueryDto) {
    return this.findQueue(query ?? {});
  }

  async findQueue(query: FindPaymentsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: Prisma.PaymentWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.settlementStatus?.length
        ? { settlementStatus: { in: query.settlementStatus } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: {
          currency: { select: { id: true, code: true, name: true } },
          paymentSource: { select: { id: true, name: true } },
          receivingAccount: { select: { id: true, name: true } },
          // Read-only for Finance: the account a confirmation will debit.
          paymentMethod: {
            select: {
              id: true,
              name: true,
              requiresReconciliation: true,
              account: { select: { id: true, code: true, name: true } },
            },
          },
          receiptLink: { select: { financialTransactionId: true } },
          storeOrder: {
            select: {
              id: true,
              internalOrderId: true,
              paymentStatus: true,
              declaredPaymentStatus: true,
              paymentType: true,
              paymentDiscrepancy: true,
              partner: {
                select: { id: true, name: true, partnerNumber: true },
              },
            },
          },
          lead: {
            select: {
              id: true,
              leadNumber: true,
              customerName: true,
            },
          },
          attachments: {
            where: { deletedAt: null },
            select: {
              id: true,
              fileName: true,
              attachmentType: true,
            },
            take: 8,
          },
          matchedBy: { select: { id: true, fullName: true } },
          verifiedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);

    const orderIds = [
      ...new Set(
        items
          .map((item) => item.storeOrderId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const settlements = new Map(
      await Promise.all(
        orderIds.map(
          async (orderId) =>
            [
              orderId,
              await computeStoreOrderSettlement(this.prisma, orderId),
            ] as const,
        ),
      ),
    );

    return {
      items: items.map((item) => ({
        ...item,
        settlement: item.storeOrderId
          ? (settlements.get(item.storeOrderId) ?? null)
          : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, deletedAt: null },
    });
    if (!payment) {
      throw new NotFoundException(`Payment ${id} not found`);
    }
    return payment;
  }

  /** Business operation: Match Payment. Manual only — requires current status PENDING. */
  async match(id: string, dto: MatchPaymentDto) {
    const existing = await this.findOne(id);
    if (existing.status !== PaymentStatus.PENDING) {
      throw new BadRequestException('Only a PENDING payment can be matched.');
    }
    const payment = await this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findFirst({
        where: { id, deletedAt: null },
      });
      if (!current || current.status !== PaymentStatus.PENDING) {
        throw new BadRequestException('Only a PENDING payment can be matched.');
      }
      assertCompanyCashClaim(current);
      const updated = await tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatus.MATCHED,
          matchedAt: new Date(),
          matchedById: dto.matchedById,
        },
      });
      await this.activityService.log(
        id,
        PaymentActivityType.MATCHED,
        'Matched',
        { matchedById: dto.matchedById },
        tx,
      );
      return updated;
    });

    if (payment.storeOrderId) {
      await this.storeOrderPaymentSync.recompute(payment.storeOrderId);
    }

    return payment;
  }

  /**
   * Business operation: Confirm & Post. One decision replaces Match →
   * Verify: validates the payment's order allocation, debit account and
   * currency, marks it VERIFIED and posts exactly one Customer Receipt with
   * its balanced Journal Entry — all in ONE database transaction, so it
   * either fully succeeds or changes nothing. Retries and double-clicks are
   * safe: the Store Order row lock serializes them, the DB-unique
   * PaymentReceiptLink blocks a second receipt, and a repeated call returns
   * the already-posted receipt.
   */
  async confirm(id: string, userId: string): Promise<PaymentConfirmResult> {
    const result = await this.prisma.$transaction(
      (tx) => this.confirmInTx(tx, id, userId),
      { maxWait: 10_000, timeout: 30_000 },
    );
    return {
      id: result.payment.id,
      paymentNumber: result.payment.paymentNumber,
      status: PaymentStatus.VERIFIED,
      alreadyPosted: result.alreadyPosted,
      receipt: result.receipt,
    };
  }

  /**
   * CONTRACT (payment-declaration-reconciliation §2): Confirm & Post inside
   * the caller's transaction (reconciliation wraps match + confirm).
   *
   * - Claim WITH a Payment Method: Dr `PaymentMethod.accountId` (validated:
   *   exists, postable leaf, ASSET, currency null or equal — else 422, never
   *   substituted) / Cr customer AR. No fee deduction. FX frozen as of
   *   `opts.rateAsOf ?? payment.paymentDate` (rate, date, source stored on
   *   the receipt; JE dated that day — a closed period fails clearly).
   *   The claim moves to AWAITING_SETTLEMENT when the method requires
   *   reconciliation, otherwise NOT_APPLICABLE (nothing to settle).
   * - Legacy claim (no method): the receiving-account path, unchanged.
   *
   * Never touches fulfillment/shipping state.
   */
  async confirmInTx(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
    opts: ConfirmClaimOptions = {},
  ): Promise<ConfirmInTxResult> {
    const head = await tx.payment.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, paymentNumber: true, storeOrderId: true },
    });
    if (!head) {
      throw new NotFoundException(`Payment ${id} not found`);
    }
    if (!head.storeOrderId) {
      throw new BadRequestException(
        `Payment ${head.paymentNumber} is not linked to a Store Order — there is no customer or order to post it against. Reject it with a reason, or record it from the order.`,
      );
    }
    const storeOrderId = head.storeOrderId;

    await lockStoreOrderRow(tx, storeOrderId);
    const payment = await tx.payment.findFirstOrThrow({
      where: { id, deletedAt: null },
      include: {
        receivingAccount: {
          select: {
            name: true,
            isActive: true,
            deletedAt: true,
            currencyId: true,
            chartOfAccount: {
              select: {
                code: true,
                name: true,
                allowsPosting: true,
                deletedAt: true,
              },
            },
          },
        },
        paymentMethod: {
          select: {
            id: true,
            name: true,
            requiresReconciliation: true,
            account: {
              select: {
                id: true,
                code: true,
                name: true,
                allowsPosting: true,
                deletedAt: true,
                accountType: true,
                currencyId: true,
              },
            },
          },
        },
      },
    });
    if (payment.status === PaymentStatus.REJECTED) {
      throw new BadRequestException(
        `Payment ${payment.paymentNumber} was rejected${payment.rejectionReason ? ` (${payment.rejectionReason})` : ''} and cannot be confirmed.`,
      );
    }
    if (payment.status === PaymentStatus.DISPUTED) {
      throw new BadRequestException(
        `Payment ${payment.paymentNumber} is disputed${payment.disputeReason ? ` (${payment.disputeReason})` : ''} — resolve the dispute before confirming.`,
      );
    }
    const alreadyVerified = payment.status === PaymentStatus.VERIFIED;
    const existingReceipt =
      await this.storeOrderCollection.findReceiptForPayment(tx, id);
    if (alreadyVerified && existingReceipt?.status === 'CONFIRMED') {
      return {
        payment,
        receiptId: existingReceipt.id,
        receipt: await this.storeOrderCollection.describeReceipt(
          tx,
          existingReceipt,
        ),
        alreadyPosted: true,
      };
    }

    // A reconciliation-enabled method is confirmed ONLY by matching it to a
    // provider statement line (which passes `statementLineId`): direct
    // Finance-review confirmation would post without statement evidence.
    // (An already-posted claim returned above — a retry — posts nothing.)
    if (
      payment.paymentMethod?.requiresReconciliation &&
      !opts.statementLineId
    ) {
      throw new ConflictException(
        `Payment ${payment.paymentNumber} uses "${payment.paymentMethod.name}", which requires reconciliation — confirm it by matching it to the provider statement in Finance → Payment reconciliation → ${payment.paymentMethod.name} (Confirm Match & Post), not from payment review.`,
      );
    }
    const order = await tx.storeOrder.findFirst({
      where: { id: storeOrderId, deletedAt: null },
      select: { currencyId: true, internalOrderId: true },
    });
    if (!order) {
      throw new BadRequestException(
        `The Store Order of payment ${payment.paymentNumber} no longer exists.`,
      );
    }
    assertPaymentCurrency(order.currencyId, payment.currencyId);
    // Agents milestone (spec §7): an agent order's company-destination claim
    // credits Agent funds payable — refused while those accounts are unset,
    // and agent-received money never enters this company-cash flow.
    await this.agentCollections.assertCompanyCollectionAllowed(tx, payment);

    let override: MethodReceiptOverride | undefined;
    if (payment.paymentMethodId) {
      const debitAccountId = this.assertMethodAccountPostable(payment);
      const rateAsOf = toDateOnly(opts.rateAsOf ?? payment.paymentDate);
      const resolved = await this.exchangeRates.snapshotRateDetailed(
        payment.currencyId,
        rateAsOf,
        tx,
      );
      override = {
        debitAccountId,
        exchangeRate: resolved.rate,
        rateAsOf,
        rateSource: describeRateSource(resolved),
      };
    } else {
      this.assertReceivingAccountPostable(payment);
    }

    if (!alreadyVerified) {
      const settlement = await computeStoreOrderSettlement(tx, storeOrderId, {
        excludePaymentId: id,
      });
      assertCanVerifyPayment(
        settlement,
        Number(payment.amount),
        await verifiedPaymentNumbers(tx, storeOrderId, id),
      );
    }

    const now = new Date();
    const verified =
      alreadyVerified && !override
        ? payment
        : await tx.payment.update({
            where: { id },
            data: {
              ...(alreadyVerified
                ? {}
                : {
                    status: PaymentStatus.VERIFIED,
                    matchedAt: payment.matchedAt ?? now,
                    matchedById: payment.matchedById ?? userId,
                    verifiedAt: now,
                    verifiedById: userId,
                  }),
              // Posted to a reconciled method's clearing account → awaits
              // provider settlement. A non-reconciled method (e.g. a direct
              // bank transfer whose linked account IS the bank) has no
              // provider statement and no settlement workspace, so its claim
              // is NOT_APPLICABLE — never stranded as "awaiting settlement".
              ...(override
                ? {
                    settlementStatus: payment.paymentMethod
                      ?.requiresReconciliation
                      ? PaymentSettlementStatus.AWAITING_SETTLEMENT
                      : PaymentSettlementStatus.NOT_APPLICABLE,
                  }
                : {}),
              updatedBy: userId,
            },
          });
    const receipt = await this.storeOrderCollection.postPaymentReceipt(
      tx,
      id,
      userId,
      override,
    );
    const debitNote = override
      ? ` (Dr ${payment.paymentMethod?.account?.code ?? ''} ${payment.paymentMethod?.name ?? ''}, rate ${override.exchangeRate} as of ${override.rateAsOf.toISOString().slice(0, 10)})`
      : '';
    await this.activityService.log(
      id,
      PaymentActivityType.CONFIRMED_AND_POSTED,
      `Confirmed & posted — Customer Receipt ${receipt.transactionNumber}${receipt.journalEntry ? `, Journal Entry ${receipt.journalEntry.entryNumber}` : ''}${debitNote}`,
      {
        userId,
        receiptId: receipt.id,
        journalEntryId: receipt.journalEntry?.id ?? null,
        debitAccountId: override?.debitAccountId ?? null,
        exchangeRate: override?.exchangeRate ?? null,
        rateAsOf: override?.rateAsOf.toISOString() ?? null,
        rateSource: override?.rateSource ?? null,
        statementLineId: opts.statementLineId ?? null,
      },
      tx,
    );
    if (payment.agentId) {
      // COLLECTION_RECEIVED credit + earning/availability (same transaction).
      await this.agentCollections.onCompanyCollectionPosted(
        tx,
        id,
        receipt,
        userId,
      );
    }
    await this.storeOrderPaymentSync.recompute(storeOrderId, tx);
    await recomputeDeclaredPaymentStatus(tx, storeOrderId);
    return {
      payment: verified,
      receiptId: receipt.id,
      receipt,
      alreadyPosted: false,
    };
  }

  /**
   * The method's clearing account must be a real posting target — never
   * silently replaced by a default (owner rule 1). 422 with the fix.
   */
  private assertMethodAccountPostable(payment: {
    paymentNumber: string;
    currencyId: string | null;
    paymentMethod: {
      name: string;
      account: {
        id: string;
        code: string;
        name: string;
        allowsPosting: boolean;
        deletedAt: Date | null;
        accountType: AccountType;
        currencyId: string | null;
      } | null;
    } | null;
  }): string {
    const method = payment.paymentMethod;
    const account = method?.account;
    const fix = `Fix the account on Payment Method "${method?.name ?? '?'}" (Master Data → Payment Methods), then confirm again.`;
    if (!account || account.deletedAt) {
      throw new UnprocessableEntityException(
        `Payment ${payment.paymentNumber} cannot be posted: its payment method has no active linked ledger account. ${fix}`,
      );
    }
    if (!account.allowsPosting) {
      throw new UnprocessableEntityException(
        `Account ${account.code} ${account.name} is a header account and cannot receive postings. ${fix}`,
      );
    }
    if (account.accountType !== AccountType.ASSET) {
      throw new UnprocessableEntityException(
        `Account ${account.code} ${account.name} is a ${account.accountType} account — a payment method must post to an ASSET (clearing/receivable) account. ${fix}`,
      );
    }
    if (
      account.currencyId &&
      payment.currencyId &&
      account.currencyId !== payment.currencyId
    ) {
      throw new UnprocessableEntityException(
        `Account ${account.code} ${account.name} is locked to a different currency than payment ${payment.paymentNumber}. ${fix}`,
      );
    }
    return account.id;
  }

  private assertReceivingAccountPostable(payment: {
    paymentNumber: string;
    currencyId: string | null;
    receivingAccount: {
      name: string;
      isActive: boolean;
      deletedAt: Date | null;
      currencyId: string | null;
      chartOfAccount: {
        code: string;
        name: string;
        allowsPosting: boolean;
        deletedAt: Date | null;
      } | null;
    } | null;
  }) {
    const account = payment.receivingAccount;
    if (!account || account.deletedAt || !account.isActive) {
      throw new BadRequestException(
        `Payment ${payment.paymentNumber} has no active receiving account — choose where the money arrived before confirming.`,
      );
    }
    const gl = account.chartOfAccount;
    if (!gl || gl.deletedAt || !gl.allowsPosting) {
      throw new BadRequestException(
        `Receiving account "${account.name}" is not linked to a postable ledger account${gl ? ` (${gl.code} ${gl.name} is a header account)` : ''} — fix it in Receiving Accounts, then confirm again.`,
      );
    }
    if (
      account.currencyId &&
      payment.currencyId &&
      account.currencyId !== payment.currencyId
    ) {
      throw new BadRequestException(
        `Receiving account "${account.name}" holds a different currency than payment ${payment.paymentNumber}.`,
      );
    }
  }

  /**
   * ADR-0018 (Order Economics M2.2) — records the ACTUAL provider
   * transaction fee for this Payment. A plain, idempotent overwrite (not an
   * append-only ledger): recording the same reconciled fee twice, or
   * correcting an earlier value, never duplicates or sums — the field
   * simply holds the current known-actual amount, same convention as
   * `Shipment.baseShippingCost`. Callable by a future automated settlement
   * import, not only this manual endpoint.
   */
  async setActualFee(id: string, actualFeeAmount: number, userId?: string) {
    await this.findOne(id);
    const payment = await this.prisma.payment.update({
      where: { id },
      data: { actualFeeAmount, updatedBy: userId ?? null },
    });
    await this.activityService.log(
      id,
      PaymentActivityType.ACTUAL_FEE_RECORDED,
      `Actual transaction fee recorded: ${actualFeeAmount}`,
      { actualFeeAmount },
    );
    return payment;
  }

  /**
   * Business operation: Dispute a declaration (Finance). PENDING/MATCHED →
   * DISPUTED with a required reason. The claim stops counting toward the
   * declared status; when fulfillment already started the order is flagged
   * with a payment discrepancy — shipment/pickup history is never touched.
   */
  async dispute(id: string, userId: string, reason: string) {
    const trimmed = reason?.trim();
    if (!trimmed) {
      throw new BadRequestException('A dispute reason is required.');
    }
    const existing = await this.findOne(id);
    const payment = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockClaimForDecision(
        tx,
        id,
        existing.storeOrderId,
      );
      if (
        !current ||
        (current.status !== PaymentStatus.PENDING &&
          current.status !== PaymentStatus.MATCHED)
      ) {
        throw new BadRequestException(
          'Only a PENDING or MATCHED payment can be disputed.',
        );
      }
      assertCompanyCashClaim(current);
      await this.assertNoActiveMatches(tx, current, 'disputing');
      const updated = await tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatus.DISPUTED,
          disputeReason: trimmed,
          updatedBy: userId,
        },
      });
      await this.activityService.log(
        id,
        PaymentActivityType.DISPUTED,
        `Disputed: ${trimmed}`,
        { userId, reason: trimmed },
        tx,
      );
      if (updated.storeOrderId) {
        await this.afterClaimWithdrawn(
          tx,
          updated.storeOrderId,
          `Payment ${updated.paymentNumber} disputed by Finance: ${trimmed}`,
          userId,
        );
      }
      return updated;
    });
    if (payment.storeOrderId) {
      await this.storeOrderPaymentSync.recompute(payment.storeOrderId);
    }
    return payment;
  }

  /**
   * Reject/dispute lock order: Store Order row, then the payment row
   * (FOR UPDATE) — the same order reconciliation's confirm uses, so a
   * decision and a concurrent statement match serialize.
   */
  private async lockClaimForDecision(
    tx: Prisma.TransactionClient,
    id: string,
    storeOrderId: string | null,
  ) {
    if (storeOrderId) await lockStoreOrderRow(tx, storeOrderId);
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.payment.findFirst({ where: { id, deletedAt: null } });
  }

  /** 409 while provider-statement allocations stand on the claim — reverse the match first. */
  private async assertNoActiveMatches(
    tx: Prisma.TransactionClient,
    payment: { id: string; paymentNumber: string },
    action: 'rejecting' | 'disputing',
  ) {
    const active = await tx.paymentMatch.count({
      where: { paymentId: payment.id, status: PaymentMatchStatus.ACTIVE },
    });
    if (active > 0) {
      throw new ConflictException(
        `Payment ${payment.paymentNumber} has ${active} active provider-statement match${active === 1 ? '' : 'es'} — reverse the match first (Finance → Payment reconciliation → "Correct match") before ${action} it.`,
      );
    }
  }

  /** A claim stopped counting (dispute/reject): recompute declared status, flag if already fulfilled. */
  private async afterClaimWithdrawn(
    tx: Prisma.TransactionClient,
    storeOrderId: string,
    reason: string,
    userId: string,
  ) {
    await recomputeDeclaredPaymentStatus(tx, storeOrderId);
    const flagged = await flagDiscrepancyIfFulfilled(tx, storeOrderId, reason);
    await tx.storeOrderActivity.create({
      data: {
        storeOrderId,
        action: flagged
          ? 'PAYMENT_DISCREPANCY_FLAGGED'
          : 'PAYMENT_CLAIM_WITHDRAWN',
        details: reason,
        performedById: userId,
      },
    });
  }

  /** Business operation: Reject Payment. Requires current status MATCHED (per the given
   *  diagram: PENDING -> MATCHED -> {VERIFIED or REJECTED}). */
  async reject(
    id: string,
    dto: RejectPaymentDto & { rejectedById: string },
    /** Set only by `AgentCollectionsService` (agents.finance.verify) — never from HTTP. */
    options: { agentCollectionReview?: boolean } = {},
  ) {
    const existing = await this.findOne(id);
    if (
      existing.status !== PaymentStatus.MATCHED &&
      existing.status !== PaymentStatus.PENDING
    ) {
      throw new BadRequestException(
        'Only a PENDING or MATCHED payment can be rejected.',
      );
    }
    const payment = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockClaimForDecision(
        tx,
        id,
        existing.storeOrderId,
      );
      if (
        !current ||
        (current.status !== PaymentStatus.MATCHED &&
          current.status !== PaymentStatus.PENDING)
      ) {
        throw new BadRequestException(
          'Only a PENDING or MATCHED payment can be rejected.',
        );
      }
      if (!options.agentCollectionReview) assertCompanyCashClaim(current);
      await this.assertNoActiveMatches(tx, current, 'rejecting');
      const updated = await tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatus.REJECTED,
          rejectedAt: new Date(),
          rejectedById: dto.rejectedById,
          rejectionReason: dto.rejectionReason,
        },
      });
      await this.activityService.log(
        id,
        PaymentActivityType.REJECTED,
        dto.rejectionReason ? `Rejected: ${dto.rejectionReason}` : 'Rejected',
        {
          rejectedById: dto.rejectedById,
          rejectionReason: dto.rejectionReason ?? null,
        },
        tx,
      );
      if (updated.storeOrderId) {
        await this.afterClaimWithdrawn(
          tx,
          updated.storeOrderId,
          `Payment ${updated.paymentNumber} rejected by Finance${dto.rejectionReason ? `: ${dto.rejectionReason}` : ''}`,
          dto.rejectedById,
        );
      }
      return updated;
    });

    if (payment.storeOrderId) {
      await this.storeOrderPaymentSync.recompute(payment.storeOrderId);
    }

    return payment;
  }

  /** Business operation: Attach Receipt. */
  async attachReceipt(id: string, dto: CreatePaymentAttachmentDto) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const attachment = await this.attachmentsService.create(id, dto, tx);
      await this.activityService.log(
        id,
        PaymentActivityType.ATTACHMENT_ADDED,
        'Attachment added',
        { attachmentId: attachment.id, attachmentType: dto.attachmentType },
        tx,
      );
      return attachment;
    });
  }

  /** Business operation: Add Note. */
  async addNote(id: string, dto: CreatePaymentNoteDto) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const note = await this.notesService.create(id, dto, tx);
      await this.activityService.log(
        id,
        PaymentActivityType.NOTE_ADDED,
        'Note added',
        { noteId: note.id },
        tx,
      );
      return note;
    });
  }
}
