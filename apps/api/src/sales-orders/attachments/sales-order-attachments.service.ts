import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateAttachmentInput {
  uploadedById: string;
  fileUrl: string;
  fileName?: string;
  attachmentType: string;
  description?: string;
  shipmentId?: string;
}

@Injectable()
export class SalesOrderAttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    salesOrderId: string,
    input: CreateAttachmentInput,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.salesOrderAttachment.create({
      data: { salesOrderId, ...input },
    });
  }

  findAllForOrder(salesOrderId: string) {
    return this.prisma.salesOrderAttachment.findMany({
      where: { salesOrderId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
