import { ForbiddenException, Injectable } from '@nestjs/common';
import { StoreOrderStockStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  StoreOrderStockService,
  type StockBackfillEntry,
} from './store-order-stock.service';

export interface StockBackfillReport {
  generatedAt: string;
  dryRun: boolean;
  summary: {
    candidates: number;
    reserve: number;
    moveToTransit: number;
    mark: number;
    skipped: number;
    short: number;
    failed: number;
  };
  orders: StockBackfillEntry[];
}

/**
 * R15 W5a (spec §7, decision D15-20) — brings the orders created before R15
 * (`stockStatus` PENDING, not archived) to the stock lifecycle through the
 * SAME `StoreOrderStockService` steps the live paths use: open orders reserve
 * (SHORT when not possible), shipped-not-delivered orders move to transit,
 * delivered / issued orders are marked from their movements. Dry run by
 * default; apply is a super admin's (it writes movements). Idempotent — a
 * second apply finds no PENDING order. Used by `POST /store-orders/stock-backfill`
 * and `prisma/scripts/r15-stock-backfill.ts`.
 */
@Injectable()
export class StockBackfillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StoreOrderStockService,
  ) {}

  async assertMayApply(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException({
        code: 'STOCK_BACKFILL_SUPER_ADMIN_ONLY',
        message:
          'ترحيل المخزون (التجربة والتطبيق) يقتصر على مدير النظام لأنه يشمل طلبات الشركة كلها — The stock backfill (dry run and apply) is limited to a super admin: it covers every pending order company-wide.',
      });
    }
  }

  async run(options: {
    dryRun: boolean;
    userId?: string;
    orderIds?: string[];
  }): Promise<StockBackfillReport> {
    const candidates = await this.prisma.storeOrder.findMany({
      where: {
        deletedAt: null,
        stockStatus: StoreOrderStockStatus.PENDING,
        ...(options.orderIds ? { id: { in: options.orderIds } } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, internalOrderId: true },
    });
    const orders: StockBackfillEntry[] = [];
    for (const candidate of candidates) {
      try {
        orders.push(
          await this.stock.backfillOrder(candidate.id, {
            dryRun: options.dryRun,
            userId: options.userId,
          }),
        );
      } catch (error) {
        orders.push({
          orderId: candidate.id,
          internalOrderId: candidate.internalOrderId,
          isAgentOrder: false,
          action: 'SKIPPED',
          before: StoreOrderStockStatus.PENDING,
          ledgerState: StoreOrderStockStatus.PENDING,
          after: null,
          short: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const count = (predicate: (entry: StockBackfillEntry) => boolean) =>
      orders.filter(predicate).length;
    return {
      generatedAt: new Date().toISOString(),
      dryRun: options.dryRun,
      summary: {
        candidates: orders.length,
        reserve: count((e) => e.action === 'RESERVE'),
        moveToTransit: count((e) => e.action === 'MOVE_TO_TRANSIT'),
        mark: count((e) => e.action === 'MARK'),
        skipped: count((e) => e.action === 'SKIPPED'),
        short: count((e) => e.short.length > 0),
        failed: count((e) => e.error !== undefined),
      },
      orders,
    };
  }
}
