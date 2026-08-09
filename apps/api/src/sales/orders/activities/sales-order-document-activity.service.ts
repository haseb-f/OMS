import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export const SalesOrderDocumentActivityType = {
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_CREATED_FROM_QUOTATION: 'ORDER_CREATED_FROM_QUOTATION',
  ORDER_UPDATED: 'ORDER_UPDATED',
  ORDER_SUBMITTED: 'ORDER_SUBMITTED',
  ORDER_APPROVED: 'ORDER_APPROVED',
  ORDER_CONFIRMED: 'ORDER_CONFIRMED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_CONVERTED_TO_INVOICE: 'ORDER_CONVERTED_TO_INVOICE',
  ORDER_PARTIALLY_DELIVERED: 'ORDER_PARTIALLY_DELIVERED',
  ORDER_DELIVERED: 'ORDER_DELIVERED',
  ORDER_CLOSED: 'ORDER_CLOSED',
  ORDER_ARCHIVED: 'ORDER_ARCHIVED',
} as const;

@Injectable()
export class SalesOrderDocumentActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    salesOrderId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.salesOrderDocumentActivity.create({
      data: {
        salesOrderId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForOrder(salesOrderId: string) {
    return this.prisma.salesOrderDocumentActivity.findMany({
      where: { salesOrderId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
