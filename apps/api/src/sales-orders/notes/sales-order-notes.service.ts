import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSalesOrderNoteDto } from '../dto/create-sales-order-note.dto';

@Injectable()
export class SalesOrderNotesService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    salesOrderId: string,
    dto: CreateSalesOrderNoteDto,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.salesOrderNote.create({
      data: { salesOrderId, userId: dto.userId, text: dto.text },
    });
  }

  findAllForOrder(salesOrderId: string) {
    return this.prisma.salesOrderNote.findMany({
      where: { salesOrderId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
