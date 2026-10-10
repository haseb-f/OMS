import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma, SalesDocumentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SalesScopeService } from '../sales-scope/sales-scope.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { CustomerLookupService } from '../customer-lookup/customer-lookup.service';
import { partnerLedgerBalances } from '../accounting/reports/partner-ledger-balance';
import { storeOrderPayableTotal } from '../store-orders/store-order-line-amount';
import {
  customerOrderStats,
  EMPTY_ORDER_STATS,
  productSummary,
} from './customer-order-stats';

/** Orders read per customer and type — a customer history, not a report. */
const MAX_ORDERS = 300;
const MAX_PAYMENTS = 100;
const MAX_PRODUCTS_PER_ORDER = 10;
const RETURN_SHIPMENT_STATUSES = new Set([
  'RETURN_BEFORE_DELIVERY',
  'RETURN_AFTER_DELIVERY',
]);

export const FINANCIAL_PERMISSIONS = [
  'finance.view',
  'customers.view_financials',
] as const;

export type HistoryOrderType = 'STORE' | 'B2B';

export interface CustomerHistoryOrder {
  id: string;
  type: HistoryOrderType;
  number: string;
  date: Date;
  productSummary: string;
  products: { name: string; quantity: number }[];
  /** Store orders: the fulfillment status definition. */
  fulfillmentStatus: {
    code: string;
    name: string;
    nameEn: string | null;
  } | null;
  /** B2B sales orders: the document status. */
  documentStatus: SalesDocumentStatus | null;
  /** Store orders only. */
  paymentStatus: string | null;
  total: number;
  currencyCode: string | null;
}

export type CustomerTimelineKind =
  'ORDER' | 'DELIVERY' | 'RETURN' | 'CANCELLATION' | 'PAYMENT';

export interface CustomerTimelineEvent {
  kind: CustomerTimelineKind;
  at: Date;
  reference: string;
  orderId: string | null;
  orderType: HistoryOrderType | null;
  /** PAYMENT events only. */
  amount?: number;
  currencyCode?: string | null;
}

export interface CustomerHistory {
  partner: { id: string; name: string; partnerNumber: string };
  /** Store orders (the repeat-customer figures); `b2b` = B2B sales orders, kept apart. */
  summary: {
    placedOrders: number;
    completedPurchases: number;
    lastOrderDate: Date | null;
    b2b: {
      placedOrders: number;
      completedPurchases: number;
      lastOrderDate: Date | null;
    };
  };
  /** Store orders the caller can open, newest first. */
  orders: CustomerHistoryOrder[];
  /** Store orders of this customer the caller cannot open — a number only. */
  otherOrdersCount: number;
  /**
   * B2B sales orders the caller can open, newest first — their own list
   * (owner, 2026-10-10: B2B orders are not part of the store orders).
   */
  b2bOrders: CustomerHistoryOrder[];
  /** B2B sales orders the caller cannot open — a number only. */
  otherB2bOrdersCount: number;
  /** Present only with `finance.view` or `customers.view_financials`. */
  financials: {
    /** Ledger receivable in the functional currency (positive = the customer owes). */
    outstandingBalance: number;
    currencyCode: string | null;
    payments: {
      id: string;
      number: string;
      date: Date;
      amount: number;
      currencyCode: string | null;
      status: PaymentStatus;
      orderId: string | null;
      orderNumber: string | null;
    }[];
  } | null;
  /** Newest first. */
  timeline: CustomerTimelineEvent[];
}

/**
 * Round 14 (W4, spec-4 §3) — one customer's history: the store orders and,
 * as a separate list, the B2B sales orders the caller can open (the caller's
 * own sales scope decides, through `SalesScopeService` — never a second scope
 * rule), how many others exist, company-wide order counts per line, an
 * optional financial section and a plain chronological timeline of the store
 * orders and payments. Company data only: agent orders are never read.
 */
@Injectable()
export class CustomerHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesScope: SalesScopeService,
    private readonly permissions: PermissionsResolverService,
    private readonly lookup: CustomerLookupService,
  ) {}

  async history(userId: string, partnerId: string): Promise<CustomerHistory> {
    const partner = await this.prisma.partner.findFirst({
      where: { id: partnerId },
      select: { id: true, name: true, partnerNumber: true },
    });
    if (!partner) throw new NotFoundException('Customer not found');

    const [scope, documentWhere, canViewDocuments, financial] =
      await Promise.all([
        this.salesScope.resolve(userId),
        this.salesScope.salesDocumentWhereForUser(userId),
        this.permissions.hasPermission(userId, 'sales.orders.view'),
        this.canViewFinancials(userId),
      ]);

    const storeWhere: Prisma.StoreOrderWhereInput = {
      partnerId,
      agentId: null,
      deletedAt: null,
    };
    const documentBase: Prisma.SalesOrderDocumentWhereInput = {
      partnerId,
      deletedAt: null,
    };
    const storeVisible: Prisma.StoreOrderWhereInput = {
      AND: [storeWhere, this.salesScope.storeOrderAccessWhere(scope)],
    };
    const documentVisible: Prisma.SalesOrderDocumentWhereInput = {
      AND: [documentBase, documentWhere],
    };
    const [
      storeTotal,
      storeVisibleCount,
      storeOrders,
      documentTotal,
      documentVisibleCount,
      documents,
      stats,
      financials,
    ] = await Promise.all([
      this.prisma.storeOrder.count({ where: storeWhere }),
      this.prisma.storeOrder.count({ where: storeVisible }),
      this.prisma.storeOrder.findMany({
        where: storeVisible,
        orderBy: [{ orderDate: 'desc' }, { id: 'desc' }],
        take: MAX_ORDERS,
        select: {
          id: true,
          internalOrderId: true,
          orderDate: true,
          updatedAt: true,
          paymentStatus: true,
          payableTotal: true,
          currency: { select: { code: true } },
          fulfillmentStatus: {
            select: { code: true, name: true, nameEn: true },
          },
          items: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            select: {
              quantity: true,
              unitPrice: true,
              agreedAmount: true,
              product: { select: { displayName: true, name: true } },
            },
          },
          shipments: {
            where: { deletedAt: null },
            select: { status: true, updatedAt: true },
          },
          activities: {
            where: { action: 'DELIVERED' },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { createdAt: true },
          },
        },
      }),
      this.prisma.salesOrderDocument.count({ where: documentBase }),
      canViewDocuments
        ? this.prisma.salesOrderDocument.count({ where: documentVisible })
        : Promise.resolve(0),
      canViewDocuments
        ? this.prisma.salesOrderDocument.findMany({
            where: documentVisible,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: MAX_ORDERS,
            select: {
              id: true,
              orderNumber: true,
              status: true,
              grandTotal: true,
              createdAt: true,
              updatedAt: true,
              confirmedAt: true,
              currency: { select: { code: true } },
              items: {
                where: { deletedAt: null },
                select: {
                  quantity: true,
                  product: { select: { displayName: true, name: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
      customerOrderStats(this.prisma, [partnerId]),
      financial ? this.financials(partnerId) : Promise.resolve(null),
    ]);

    const productsOf = (
      items: {
        quantity: number;
        product: { displayName: string; name: string };
      }[],
    ) =>
      items.map((item) => ({
        name: item.product.displayName || item.product.name,
        quantity: item.quantity,
      }));

    const orders: CustomerHistoryOrder[] = storeOrders.map((order) => {
      const products = productsOf(order.items);
      return {
        id: order.id,
        type: 'STORE' as const,
        number: order.internalOrderId,
        date: order.orderDate,
        productSummary: productSummary(products.map((p) => p.name)),
        products: products.slice(0, MAX_PRODUCTS_PER_ORDER),
        fulfillmentStatus: order.fulfillmentStatus,
        documentStatus: null,
        paymentStatus: order.paymentStatus,
        total: storeOrderPayableTotal(order),
        currencyCode: order.currency?.code ?? null,
      };
    });
    const b2bOrders: CustomerHistoryOrder[] = documents
      .map((document) => {
        const products = productsOf(document.items);
        return {
          id: document.id,
          type: 'B2B' as const,
          number: document.orderNumber,
          date: document.confirmedAt ?? document.createdAt,
          productSummary: productSummary(products.map((p) => p.name)),
          products: products.slice(0, MAX_PRODUCTS_PER_ORDER),
          fulfillmentStatus: null,
          documentStatus: document.status,
          paymentStatus: null,
          total: Number(document.grandTotal),
          currencyCode: document.currency?.code ?? null,
        };
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    const timeline: CustomerTimelineEvent[] = [];
    for (const order of storeOrders) {
      const base = {
        reference: order.internalOrderId,
        orderId: order.id,
        orderType: 'STORE' as const,
      };
      timeline.push({ kind: 'ORDER', at: order.orderDate, ...base });
      const code = order.fulfillmentStatus?.code ?? null;
      const delivered = order.shipments.filter((s) => s.status === 'DELIVERED');
      const returned = order.shipments.filter((s) =>
        RETURN_SHIPMENT_STATUSES.has(s.status ?? ''),
      );
      const deliveredAt =
        order.activities[0]?.createdAt ??
        latest(delivered.map((s) => s.updatedAt)) ??
        (code === 'DELIVERED' || code === 'COLLECTED' ? order.updatedAt : null);
      if (deliveredAt) {
        timeline.push({ kind: 'DELIVERY', at: deliveredAt, ...base });
      }
      const returnedAt =
        latest(returned.map((s) => s.updatedAt)) ??
        (code === 'RETURNED' ? order.updatedAt : null);
      if (returnedAt) {
        timeline.push({ kind: 'RETURN', at: returnedAt, ...base });
      }
      if (code === 'CANCELLED') {
        timeline.push({ kind: 'CANCELLATION', at: order.updatedAt, ...base });
      }
    }
    for (const payment of financials?.payments ?? []) {
      if (payment.status === PaymentStatus.REJECTED) continue;
      timeline.push({
        kind: 'PAYMENT',
        at: payment.date,
        reference: payment.number,
        orderId: payment.orderId,
        orderType: payment.orderId ? 'STORE' : null,
        amount: payment.amount,
        currencyCode: payment.currencyCode,
      });
    }
    timeline.sort((a, b) => b.at.getTime() - a.at.getTime());

    const counts = stats.get(partnerId) ?? EMPTY_ORDER_STATS;
    return {
      partner,
      summary: {
        placedOrders: counts.placedOrders,
        completedPurchases: counts.completedPurchases,
        lastOrderDate: counts.lastOrderDate,
        b2b: counts.b2b,
      },
      orders,
      otherOrdersCount: Math.max(storeTotal - storeVisibleCount, 0),
      b2bOrders,
      otherB2bOrdersCount: Math.max(documentTotal - documentVisibleCount, 0),
      financials,
      timeline,
    };
  }

  /**
   * The repeat-customer numbers alone, for the badge on pages that show a
   * customer (e.g. a store order). Open to `partners.view`, or to a caller who
   * can already open one of this customer's company orders or leads; anyone
   * else gets 404 (existence is not disclosed).
   */
  async orderStats(userId: string, partnerId: string) {
    const allowed =
      (await this.permissions.hasPermission(userId, 'partners.view')) ||
      (await this.lookup.callerCanOpenPartner(userId, partnerId));
    if (!allowed) throw new NotFoundException('Customer not found');
    const exists = await this.prisma.partner.count({
      where: { id: partnerId },
    });
    if (!exists) throw new NotFoundException('Customer not found');
    const counts =
      (await customerOrderStats(this.prisma, [partnerId])).get(partnerId) ??
      EMPTY_ORDER_STATS;
    return {
      placedOrders: counts.placedOrders,
      completedPurchases: counts.completedPurchases,
      b2b: {
        placedOrders: counts.b2b.placedOrders,
        completedPurchases: counts.b2b.completedPurchases,
      },
    };
  }

  private async canViewFinancials(userId: string): Promise<boolean> {
    const held = await Promise.all(
      FINANCIAL_PERMISSIONS.map((name) =>
        this.permissions.hasPermission(userId, name),
      ),
    );
    return held.some(Boolean);
  }

  private async financials(
    partnerId: string,
  ): Promise<NonNullable<CustomerHistory['financials']>> {
    const [balances, settings, payments] = await Promise.all([
      partnerLedgerBalances(this.prisma, [partnerId]),
      this.prisma.postingSettings.findFirst({
        select: { functionalCurrency: { select: { code: true } } },
      }),
      this.prisma.payment.findMany({
        where: {
          deletedAt: null,
          storeOrder: { partnerId, agentId: null, deletedAt: null },
        },
        orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
        take: MAX_PAYMENTS,
        select: {
          id: true,
          paymentNumber: true,
          paymentDate: true,
          amount: true,
          status: true,
          currency: { select: { code: true } },
          storeOrder: { select: { id: true, internalOrderId: true } },
        },
      }),
    ]);
    return {
      outstandingBalance: balances.get(partnerId)?.receivable ?? 0,
      currencyCode: settings?.functionalCurrency?.code ?? null,
      payments: payments.map((payment) => ({
        id: payment.id,
        number: payment.paymentNumber,
        date: payment.paymentDate,
        amount: Number(payment.amount),
        currencyCode: payment.currency?.code ?? null,
        status: payment.status,
        orderId: payment.storeOrder?.id ?? null,
        orderNumber: payment.storeOrder?.internalOrderId ?? null,
      })),
    };
  }
}

function latest(dates: Date[]): Date | null {
  return dates.reduce<Date | null>(
    (max, date) => (!max || date > max ? date : max),
    null,
  );
}
