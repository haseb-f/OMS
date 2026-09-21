import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { StoreOrderPaymentSyncService } from '../store-orders/store-order-payment-sync.service';
import {
  StoreOrderCollectionService,
  type PostedPaymentReceipt,
} from '../accounting/store-order-collection/store-order-collection.service';
import {
  PaymentActivityService,
  PaymentActivityType,
} from './activities/payment-activity.service';
import { PaymentNotesService } from './notes/payment-notes.service';
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
    };
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: {
          currency: { select: { id: true, code: true, name: true } },
          paymentSource: { select: { id: true, name: true } },
          receivingAccount: { select: { id: true, name: true } },
          storeOrder: {
            select: {
              id: true,
              internalOrderId: true,
              paymentStatus: true,
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
   * Verify: validates the payment's order allocation, receiving account and
   * currency, marks it VERIFIED and posts exactly one Customer Receipt with
   * its balanced Journal Entry — all in ONE database transaction, so it
   * either fully succeeds or changes nothing (no "verified but not posted"
   * half state). Retries and double-clicks are safe: the Store Order row
   * lock serializes them and a second call returns the already-posted
   * receipt instead of posting again.
   */
  async confirm(id: string, userId: string): Promise<PaymentConfirmResult> {
    const head = await this.findOne(id);
    if (!head.storeOrderId) {
      throw new BadRequestException(
        `Payment ${head.paymentNumber} is not linked to a Store Order — there is no customer or order to post it against. Reject it with a reason, or record it from the order.`,
      );
    }
    const storeOrderId = head.storeOrderId;

    const result = await this.prisma.$transaction(
      async (tx) => {
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
          },
        });
        if (payment.status === PaymentStatus.REJECTED) {
          throw new BadRequestException(
            `Payment ${payment.paymentNumber} was rejected${payment.rejectionReason ? ` (${payment.rejectionReason})` : ''} and cannot be confirmed.`,
          );
        }
        const alreadyVerified = payment.status === PaymentStatus.VERIFIED;
        const existingReceipt =
          await this.storeOrderCollection.findReceiptForPayment(tx, id);
        if (alreadyVerified && existingReceipt?.status === 'CONFIRMED') {
          return {
            payment,
            receipt: await this.storeOrderCollection.describeReceipt(
              tx,
              existingReceipt,
            ),
            alreadyPosted: true,
          };
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
        this.assertReceivingAccountPostable(payment);

        if (!alreadyVerified) {
          const settlement = await computeStoreOrderSettlement(
            tx,
            storeOrderId,
            { excludePaymentId: id },
          );
          assertCanVerifyPayment(
            settlement,
            Number(payment.amount),
            await verifiedPaymentNumbers(tx, storeOrderId, id),
          );
        }

        const now = new Date();
        const verified = alreadyVerified
          ? payment
          : await tx.payment.update({
              where: { id },
              data: {
                status: PaymentStatus.VERIFIED,
                matchedAt: payment.matchedAt ?? now,
                matchedById: payment.matchedById ?? userId,
                verifiedAt: now,
                verifiedById: userId,
                updatedBy: userId,
              },
            });
        const receipt = await this.storeOrderCollection.postPaymentReceipt(
          tx,
          id,
          userId,
        );
        await this.activityService.log(
          id,
          PaymentActivityType.CONFIRMED_AND_POSTED,
          `Confirmed & posted — Customer Receipt ${receipt.transactionNumber}${receipt.journalEntry ? `, Journal Entry ${receipt.journalEntry.entryNumber}` : ''}`,
          {
            userId,
            receiptId: receipt.id,
            journalEntryId: receipt.journalEntry?.id ?? null,
          },
          tx,
        );
        await this.storeOrderPaymentSync.recompute(storeOrderId, tx);
        return { payment: verified, receipt, alreadyPosted: false };
      },
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

  /** Business operation: Reject Payment. Requires current status MATCHED (per the given
   *  diagram: PENDING -> MATCHED -> {VERIFIED or REJECTED}). */
  async reject(id: string, dto: RejectPaymentDto & { rejectedById: string }) {
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
      const current = await tx.payment.findFirst({
        where: { id, deletedAt: null },
      });
      if (
        !current ||
        (current.status !== PaymentStatus.MATCHED &&
          current.status !== PaymentStatus.PENDING)
      ) {
        throw new BadRequestException(
          'Only a PENDING or MATCHED payment can be rejected.',
        );
      }
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
