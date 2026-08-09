import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export const PurchaseInvoiceActivityType = {
  INVOICE_CREATED: 'INVOICE_CREATED',
  INVOICE_CREATED_FROM_ORDER: 'INVOICE_CREATED_FROM_ORDER',
  INVOICE_UPDATED: 'INVOICE_UPDATED',
  INVOICE_SUBMITTED: 'INVOICE_SUBMITTED',
  INVOICE_APPROVED: 'INVOICE_APPROVED',
  INVOICE_CANCELLED: 'INVOICE_CANCELLED',
  INVOICE_CONFIRMED: 'INVOICE_CONFIRMED',
  INVOICE_ARCHIVED: 'INVOICE_ARCHIVED',
} as const;

@Injectable()
export class PurchaseInvoiceActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    purchaseInvoiceId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.purchaseInvoiceActivity.create({
      data: {
        purchaseInvoiceId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForInvoice(purchaseInvoiceId: string) {
    return this.prisma.purchaseInvoiceActivity.findMany({
      where: { purchaseInvoiceId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
