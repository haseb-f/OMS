import { Injectable } from '@nestjs/common';
import { Prisma, StoreOrderActivitySource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export { StoreOrderActivitySource };

/**
 * Append-only audit trail (schema: `StoreOrderActivity` has no
 * updatedAt/updatedBy/deletedAt) — never updated or deleted by any code
 * path, same convention as InventoryMovement (ADR-0013). `action` is a
 * plain string, not a closed enum — same reasoning as LeadActivity.type /
 * SalesOrderActivity.type elsewhere in this codebase.
 */
export const StoreOrderActivityType = {
  ORDER_CREATED: 'ORDER_CREATED',
  PAYMENT_ADDED: 'PAYMENT_ADDED',
  PAYMENT_STATUS_CHANGED: 'PAYMENT_STATUS_CHANGED',
  SHIPPING_STAGE_CHANGED: 'SHIPPING_STAGE_CHANGED',
  INVOICE_GENERATED: 'INVOICE_GENERATED',
  NOTE_ADDED: 'NOTE_ADDED',
  ORDER_UPDATED: 'ORDER_UPDATED',
  ORDER_ARCHIVED: 'ORDER_ARCHIVED',
  SHIPMENT_CREATED: 'SHIPMENT_CREATED',
  SHIPPING_COMPANY_ASSIGNED: 'SHIPPING_COMPANY_ASSIGNED',
  TRACKING_UPDATED: 'TRACKING_UPDATED',
  LABEL_CREATED: 'LABEL_CREATED',
  SHIPPED: 'SHIPPED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  RESHIPPED: 'RESHIPPED',
  SHIPPING_COST_ADDED: 'SHIPPING_COST_ADDED',
  RECEIPT_ATTACHED: 'RECEIPT_ATTACHED',
} as const;

@Injectable()
export class StoreOrderActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `source` is a new, backward-compatible trailing parameter (Data
   * Synchronization — Google Sheets shipping sync, section 28) — every
   * existing call site that only ever passed the first 5 arguments keeps
   * defaulting to `MANUAL` unchanged; only the bulk-update and
   * import/sync-driven call sites pass it explicitly.
   */
  log(
    storeOrderId: string,
    action: string,
    details?: string,
    performedById?: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
    source: StoreOrderActivitySource = StoreOrderActivitySource.MANUAL,
  ) {
    return tx.storeOrderActivity.create({
      data: { storeOrderId, action, details, performedById, source },
    });
  }

  findAllForOrder(storeOrderId: string) {
    return this.prisma.storeOrderActivity.findMany({
      where: { storeOrderId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
