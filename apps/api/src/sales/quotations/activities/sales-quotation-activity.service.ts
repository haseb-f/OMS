import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export const SalesQuotationActivityType = {
  QUOTATION_CREATED: 'QUOTATION_CREATED',
  QUOTATION_UPDATED: 'QUOTATION_UPDATED',
  QUOTATION_SUBMITTED: 'QUOTATION_SUBMITTED',
  QUOTATION_APPROVED: 'QUOTATION_APPROVED',
  QUOTATION_CANCELLED: 'QUOTATION_CANCELLED',
  QUOTATION_CONVERTED_TO_ORDER: 'QUOTATION_CONVERTED_TO_ORDER',
  QUOTATION_ARCHIVED: 'QUOTATION_ARCHIVED',
} as const;

@Injectable()
export class SalesQuotationActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    salesQuotationId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.salesQuotationActivity.create({
      data: {
        salesQuotationId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForQuotation(salesQuotationId: string) {
    return this.prisma.salesQuotationActivity.findMany({
      where: { salesQuotationId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
