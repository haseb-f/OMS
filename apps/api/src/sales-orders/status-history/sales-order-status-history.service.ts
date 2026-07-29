import { Injectable } from '@nestjs/common';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Decision #1: dedicated, append-only status log. Never updated, never
 * deleted — enforced simply by this service never defining update/remove
 * methods. Every status transition creates a new row via `record()`.
 */
@Injectable()
export class SalesOrderStatusHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    salesOrderId: string,
    fromStatus: SalesOrderStatus | null,
    toStatus: SalesOrderStatus,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.salesOrderStatusHistory.create({
      data: { salesOrderId, fromStatus, toStatus },
    });
  }

  findAllForOrder(salesOrderId: string) {
    return this.prisma.salesOrderStatusHistory.findMany({
      where: { salesOrderId },
      orderBy: { changedAt: 'asc' },
    });
  }
}
