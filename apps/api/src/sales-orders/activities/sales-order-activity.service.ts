import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Decision #9: "Timeline is not Status History." Examples given are not a
 * closed set — `SalesOrderActivity.type` is a plain string column, same
 * reasoning as LeadActivityType.
 */
export const SalesOrderActivityType = {
  ORDER_CREATED: 'ORDER_CREATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  READY_FOR_SHIPPING: 'READY_FOR_SHIPPING',
  LABEL_CREATED: 'LABEL_CREATED',
  SHIPPING_EMPLOYEE_ASSIGNED: 'SHIPPING_EMPLOYEE_ASSIGNED',
  SHIPPING_COMPANY_ASSIGNED: 'SHIPPING_COMPANY_ASSIGNED',
  SHIPMENT_CREATED: 'SHIPMENT_CREATED',
  TRACKING_UPDATED: 'TRACKING_UPDATED',
  SHIPPING_COST_ADDED: 'SHIPPING_COST_ADDED',
  ATTACHMENT_UPLOADED: 'ATTACHMENT_UPLOADED',
  NOTE_ADDED: 'NOTE_ADDED',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  RETURNED: 'RETURNED',
  RESHIPPED: 'RESHIPPED',
} as const;

@Injectable()
export class SalesOrderActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    salesOrderId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.salesOrderActivity.create({
      data: {
        salesOrderId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForOrder(salesOrderId: string) {
    return this.prisma.salesOrderActivity.findMany({
      where: { salesOrderId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
