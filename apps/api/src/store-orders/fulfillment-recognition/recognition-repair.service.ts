import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  InventoryMovementType,
  PaymentStatus,
  Prisma,
  SalesDocumentStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountMappingService } from '../../accounting/account-mapping/account-mapping.service';
import {
  FulfillmentRecognitionService,
  type RecognitionStockNeed,
} from './fulfillment-recognition.service';
import { errorText, type RecognitionIssue } from './recognition-errors';
import { isRecognitionDue } from './recognition-routing';

/** Fulfillment codes / shipment status that put an order in the repair scan. */
const DELIVERED_WHERE: Prisma.StoreOrderWhereInput = {
  OR: [
    { fulfillmentStatus: { code: { in: ['DELIVERED', 'COLLECTED'] } } },
    { shipments: { some: { deletedAt: null, status: 'DELIVERED' } } },
  ],
};

export interface RepairOrderEntry {
  orderId: string;
  internalOrderId: string;
  lines: { productId: string; sku: string; quantity: number }[];
  stock: RecognitionStockNeed[];
  predictedInvoiceTotal: number;
  predictedCogs: string;
  blockers: RecognitionIssue[];
  result:
    | 'WOULD_RECOGNIZE'
    | 'BLOCKED'
    | 'RECOGNIZED'
    | 'FAILED'
    | 'ALREADY_RECOGNIZED';
  invoiceNumber?: string;
  error?: unknown;
}

export interface RepairReconciliation {
  onHandByProduct: Record<string, number>;
  inventoryGl: string;
  cogsGl: string;
  receivableGl: string;
  /** Σ verified customer payments of the scanned orders (never changed by the repair). */
  verifiedPayments: string;
  /** Σ receipt allocations to the scanned orders' invoices. */
  receiptAllocations: string;
}

export interface RepairReport {
  generatedAt: string;
  dryRun: boolean;
  summary: {
    companyCandidates: number;
    recognizable: number;
    blocked: number;
    recognized: number;
    failed: number;
    agentNotDispatched: number;
  };
  orders: RepairOrderEntry[];
  /** Delivered agent orders whose stock was never issued — reported for the agent team, not repaired here. */
  agentOrdersNotDispatched: { orderId: string; internalOrderId: string }[];
  reconciliation: {
    before: RepairReconciliation;
    after: RepairReconciliation | null;
  };
}

/**
 * R14 W3 (spec-3 §6) — finds delivered / collected company store orders that
 * were never recognised (the ADR-0017 payment gate) and recognises them
 * through the SAME `FulfillmentRecognitionService` the delivery hooks use.
 * Dry run by default: lists each order's lines, required stock per warehouse,
 * on-hand, cost availability, predicted invoice total / COGS and blockers.
 * Apply recognises the unblocked ones (idempotent — a second apply is a
 * no-op); blocked orders are reported, never forced. Receipts are never
 * re-posted — existing advances are allocated by `syncVerifiedPayments`.
 *
 * Used by `POST /store-orders/recognition-repair` and
 * `prisma/scripts/r14-recognition-repair.ts`.
 */
@Injectable()
export class RecognitionRepairService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recognition: FulfillmentRecognitionService,
    private readonly accountMapping: AccountMappingService,
  ) {}

  /** The endpoint's gate: anyone with generate_invoice may dry-run; applying needs a super admin. */
  async assertMayApply(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException({
        code: 'RECOGNITION_REPAIR_SUPER_ADMIN_ONLY',
        message:
          'تطبيق الإصلاح يغيّر السجلات المالية ويقتصر على مدير النظام — Applying the repair changes financial records and is limited to a super admin. Run the dry run instead.',
      });
    }
  }

  async run(options: {
    dryRun: boolean;
    userId?: string;
    /** Limit the scan to these orders (default: every delivered order). */
    orderIds?: string[];
  }): Promise<RepairReport> {
    const candidates = await this.prisma.storeOrder.findMany({
      where: {
        deletedAt: null,
        agentId: null,
        ...(options.orderIds ? { id: { in: options.orderIds } } : {}),
        invoices: {
          none: {
            deletedAt: null,
            status: { not: SalesDocumentStatus.CANCELLED },
          },
        },
        ...DELIVERED_WHERE,
      },
      select: { id: true },
      orderBy: { orderDate: 'asc' },
    });
    const agentOrders = await this.prisma.storeOrder.findMany({
      where: {
        deletedAt: null,
        agentId: { not: null },
        ...(options.orderIds ? { id: { in: options.orderIds } } : {}),
        agentDispatchedAt: null,
        ...DELIVERED_WHERE,
      },
      select: { id: true, internalOrderId: true },
      orderBy: { orderDate: 'asc' },
    });

    const entries: RepairOrderEntry[] = [];
    for (const candidate of candidates) {
      const order = await this.recognition.loadOrder(this.prisma, candidate.id);
      if (!order || !isRecognitionDue(order)) continue;
      const preflight = await this.recognition.preflight(order);
      entries.push({
        orderId: order.id,
        internalOrderId: order.internalOrderId,
        lines: order.items.map((item) => ({
          productId: item.productId,
          sku: item.product.sku,
          quantity: item.quantity,
        })),
        stock: preflight.stock,
        predictedInvoiceTotal: preflight.invoiceTotal,
        predictedCogs: preflight.estimatedCogs,
        blockers: preflight.issues,
        result: preflight.issues.length > 0 ? 'BLOCKED' : 'WOULD_RECOGNIZE',
      });
    }

    const scope = await this.reconciliationScope(entries);
    const before = await this.reconcile(scope);

    if (!options.dryRun) {
      for (const entry of entries) {
        if (entry.result !== 'WOULD_RECOGNIZE') continue;
        try {
          const invoice = await this.recognition.recognize(
            entry.orderId,
            options.userId,
            'REPAIR',
          );
          if (invoice) {
            entry.result = 'RECOGNIZED';
            entry.invoiceNumber = invoice.invoiceNumber;
          } else {
            entry.result = 'FAILED';
            entry.error = (
              await this.prisma.storeOrder.findUnique({
                where: { id: entry.orderId },
                select: { recognitionError: true },
              })
            )?.recognitionError;
          }
        } catch (error) {
          entry.result = 'FAILED';
          entry.error = errorText(error);
        }
      }
    }

    const after = options.dryRun ? null : await this.reconcile(scope);
    const count = (result: RepairOrderEntry['result']) =>
      entries.filter((entry) => entry.result === result).length;
    return {
      generatedAt: new Date().toISOString(),
      dryRun: options.dryRun,
      summary: {
        companyCandidates: entries.length,
        recognizable: options.dryRun
          ? count('WOULD_RECOGNIZE')
          : count('RECOGNIZED') + count('FAILED'),
        blocked: count('BLOCKED'),
        recognized: count('RECOGNIZED'),
        failed: count('FAILED'),
        agentNotDispatched: agentOrders.length,
      },
      orders: entries,
      agentOrdersNotDispatched: agentOrders.map((order) => ({
        orderId: order.id,
        internalOrderId: order.internalOrderId,
      })),
      reconciliation: { before, after },
    };
  }

  /** Products, GL accounts and orders the before/after figures are taken over. */
  private async reconciliationScope(entries: RepairOrderEntry[]) {
    const productIds = [
      ...new Set(
        entries.flatMap((entry) => entry.stock.map((s) => s.productId)),
      ),
    ];
    const orderIds = entries.map((entry) => entry.orderId);
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { categoryId: true },
        })
      : [];
    const lineProducts = orderIds.length
      ? await this.prisma.storeOrderItem.findMany({
          where: { storeOrderId: { in: orderIds } },
          select: { product: { select: { categoryId: true } } },
        })
      : [];
    const categories = [
      ...new Set([
        ...products.map((p) => p.categoryId),
        ...lineProducts.map((l) => l.product.categoryId),
      ]),
    ];
    const partners = orderIds.length
      ? await this.prisma.storeOrder.findMany({
          where: { id: { in: orderIds } },
          select: { partnerId: true },
          distinct: ['partnerId'],
        })
      : [];
    const settle = async (resolve: () => Promise<string>) => {
      try {
        return await resolve();
      } catch {
        return null;
      }
    };
    const ids = async (resolvers: (() => Promise<string>)[]) =>
      [
        ...new Set((await Promise.all(resolvers.map(settle))).filter(Boolean)),
      ] as string[];
    return {
      productIds,
      orderIds,
      inventoryAccounts: await ids(
        categories.map(
          (c) => () => this.accountMapping.resolveInventoryAccount(c),
        ),
      ),
      cogsAccounts: await ids(
        categories.map((c) => () => this.accountMapping.resolveCogsAccount(c)),
      ),
      receivableAccounts: await ids(
        partners.map(
          (p) => () =>
            this.accountMapping.resolveReceivableAccount(p.partnerId),
        ),
      ),
    };
  }

  private async reconcile(
    scope: Awaited<ReturnType<RecognitionRepairService['reconciliationScope']>>,
  ): Promise<RepairReconciliation> {
    const onHand = scope.productIds.length
      ? await this.prisma.inventoryMovement.groupBy({
          by: ['productId'],
          where: {
            productId: { in: scope.productIds },
            type: {
              notIn: [
                InventoryMovementType.RESERVATION,
                InventoryMovementType.RESERVATION_RELEASE,
              ],
            },
          },
          _sum: { quantity: true },
        })
      : [];
    const balance = async (accountIds: string[]) => {
      if (accountIds.length === 0) return '0.00';
      const sums = await this.prisma.journalEntryLine.aggregate({
        where: {
          accountId: { in: accountIds },
          journalEntry: {
            deletedAt: null,
            status: { in: ['POSTED', 'REVERSED'] },
          },
        },
        _sum: { debit: true, credit: true },
      });
      return new Prisma.Decimal(sums._sum.debit ?? 0)
        .sub(sums._sum.credit ?? 0)
        .toFixed(2);
    };
    const payments = scope.orderIds.length
      ? await this.prisma.payment.aggregate({
          where: {
            storeOrderId: { in: scope.orderIds },
            deletedAt: null,
            status: PaymentStatus.VERIFIED,
          },
          _sum: { amount: true },
        })
      : null;
    const allocations = scope.orderIds.length
      ? await this.prisma.financialTransactionAllocation.aggregate({
          where: {
            salesInvoice: {
              storeOrderId: { in: scope.orderIds },
              deletedAt: null,
            },
          },
          _sum: { allocatedAmount: true },
        })
      : null;
    return {
      onHandByProduct: Object.fromEntries(
        onHand.map((row) => [row.productId, row._sum.quantity ?? 0]),
      ),
      inventoryGl: await balance(scope.inventoryAccounts),
      cogsGl: await balance(scope.cogsAccounts),
      receivableGl: await balance(scope.receivableAccounts),
      verifiedPayments: new Prisma.Decimal(payments?._sum.amount ?? 0).toFixed(
        2,
      ),
      receiptAllocations: new Prisma.Decimal(
        allocations?._sum.allocatedAmount ?? 0,
      ).toFixed(2),
    };
  }
}
