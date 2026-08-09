import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export const PurchaseQuotationActivityType = {
  QUOTATION_CREATED: 'QUOTATION_CREATED',
  QUOTATION_UPDATED: 'QUOTATION_UPDATED',
  QUOTATION_SUBMITTED: 'QUOTATION_SUBMITTED',
  QUOTATION_APPROVED: 'QUOTATION_APPROVED',
  QUOTATION_CANCELLED: 'QUOTATION_CANCELLED',
  QUOTATION_ARCHIVED: 'QUOTATION_ARCHIVED',
  QUOTATION_CONVERTED_TO_ORDER: 'QUOTATION_CONVERTED_TO_ORDER',
} as const;

@Injectable()
export class PurchaseQuotationActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    purchaseQuotationId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.purchaseQuotationActivity.create({
      data: {
        purchaseQuotationId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForQuotation(purchaseQuotationId: string) {
    return this.prisma.purchaseQuotationActivity.findMany({
      where: { purchaseQuotationId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
