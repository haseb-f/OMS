import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaymentNoteDto } from '../dto/create-payment-note.dto';

@Injectable()
export class PaymentNotesService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    paymentId: string,
    dto: CreatePaymentNoteDto,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.paymentNote.create({
      data: {
        paymentId,
        userId: dto.userId as string,
        text: dto.text,
      },
    });
  }

  findAllForPayment(paymentId: string) {
    return this.prisma.paymentNote.findMany({
      where: { paymentId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
