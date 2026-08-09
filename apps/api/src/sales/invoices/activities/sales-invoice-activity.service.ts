import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export const SalesInvoiceActivityType = {
  INVOICE_CREATED: 'INVOICE_CREATED',
  INVOICE_CREATED_FROM_ORDER: 'INVOICE_CREATED_FROM_ORDER',
  INVOICE_UPDATED: 'INVOICE_UPDATED',
  INVOICE_SUBMITTED: 'INVOICE_SUBMITTED',
  INVOICE_APPROVED: 'INVOICE_APPROVED',
  INVOICE_CONFIRMED: 'INVOICE_CONFIRMED',
  INVOICE_CANCELLED: 'INVOICE_CANCELLED',
  INVOICE_CLOSED: 'INVOICE_CLOSED',
  INVOICE_ARCHIVED: 'INVOICE_ARCHIVED',
} as const;

@Injectable()
export class SalesInvoiceActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    salesInvoiceId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.salesInvoiceActivity.create({
      data: {
        salesInvoiceId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForInvoice(salesInvoiceId: string) {
    return this.prisma.salesInvoiceActivity.findMany({
      where: { salesInvoiceId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
