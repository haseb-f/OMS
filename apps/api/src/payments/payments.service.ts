import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingEngineService } from '../numbering/numbering-engine.service';
import { LeadsService } from '../leads/leads.service';
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
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { RejectPaymentDto } from './dto/reject-payment.dto';

/**
 * Payment Workflow: Customer sends payment -> Payment record created ->
 * Accounting reviews bank statement manually -> Accounting matches payment
 * -> Payment becomes VERIFIED -> Lead automatically becomes PAID -> Sales
 * Order can now be created. Matching is manual only in this phase — see
 * PaymentAutoMatchingService for the (unused) architecture placeholder.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadsService: LeadsService,
    private readonly activityService: PaymentActivityService,
    private readonly notesService: PaymentNotesService,
    private readonly attachmentsService: PaymentAttachmentsService,
    private readonly numberingEngine: NumberingEngineService,
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

  findAll() {
    return this.prisma.payment.findMany({ where: { deletedAt: null } });
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
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.update({
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
      return payment;
    });
  }

  /** Business operation: Verify Payment. Requires current status MATCHED. Cascades:
   *  "Payment becomes VERIFIED -> Lead automatically becomes PAID." */
  async verify(id: string, dto: VerifyPaymentDto) {
    const existing = await this.findOne(id);
    if (existing.status !== PaymentStatus.MATCHED) {
      throw new BadRequestException('Only a MATCHED payment can be verified.');
    }
    const payment = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatus.VERIFIED,
          verifiedAt: new Date(),
          verifiedById: dto.verifiedById,
        },
      });
      await this.activityService.log(
        id,
        PaymentActivityType.VERIFIED,
        'Verified',
        { verifiedById: dto.verifiedById },
        tx,
      );
      return updated;
    });

    if (payment.leadId) {
      await this.leadsService.markPaid(payment.leadId);
    }

    return payment;
  }

  /** Business operation: Reject Payment. Requires current status MATCHED (per the given
   *  diagram: PENDING -> MATCHED -> {VERIFIED or REJECTED}). */
  async reject(id: string, dto: RejectPaymentDto) {
    const existing = await this.findOne(id);
    if (existing.status !== PaymentStatus.MATCHED) {
      throw new BadRequestException('Only a MATCHED payment can be rejected.');
    }
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.update({
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
      return payment;
    });
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
