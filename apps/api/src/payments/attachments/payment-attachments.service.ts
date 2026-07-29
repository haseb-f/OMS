import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaymentAttachmentDto } from '../dto/create-payment-attachment.dto';

@Injectable()
export class PaymentAttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    paymentId: string,
    dto: CreatePaymentAttachmentDto,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.paymentAttachment.create({ data: { paymentId, ...dto } });
  }

  findAllForPayment(paymentId: string) {
    return this.prisma.paymentAttachment.findMany({
      where: { paymentId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
