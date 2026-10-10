import { Prisma, SalesDocumentStatus } from '@prisma/client';

/**
 * Round 14 (W4, spec-4 §2) — the ONE definition of a customer's order counts,
 * shared by the advanced lookup card, the order-entry duplicate panel, the
 * repeat-customer badge and the customer history summary.
 *
 * - placedOrders: company store orders of the partner whose fulfillment is not
 *   CANCELLED (store orders have no draft state).
 * - completedPurchases: store orders fulfilled DELIVERED or COLLECTED (a
 *   RETURNED order is never completed).
 * - b2b: B2B sales orders are their own business line (owner, 2026-10-10:
 *   "B2B orders are not part of store orders — they stand on their own"), so
 *   they are counted separately and never feed the store figures or the
 *   repeat-customer label: placed = neither DRAFT nor CANCELLED, completed =
 *   DELIVERED or CLOSED.
 *
 * Counted across the company (not the viewer's scope) but only the numbers
 * ever leave the server. Agent orders are the agent's business and are never
 * counted for the company (`agentId: null`), deleted orders never.
 */

export const REPEAT_CUSTOMER_MIN_ORDERS = 2;

const NOT_PLACED_FULFILLMENT = new Set(['CANCELLED']);
const COMPLETED_FULFILLMENT = new Set(['DELIVERED', 'COLLECTED']);
const NOT_PLACED_SALES_DOCUMENT = new Set<SalesDocumentStatus>([
  SalesDocumentStatus.DRAFT,
  SalesDocumentStatus.CANCELLED,
]);
const COMPLETED_SALES_DOCUMENT = new Set<SalesDocumentStatus>([
  SalesDocumentStatus.DELIVERED,
  SalesDocumentStatus.CLOSED,
]);

/** A store order with no fulfillment status yet is placed (it is simply new). */
export function isPlacedStoreOrder(fulfillmentCode: string | null | undefined) {
  return !NOT_PLACED_FULFILLMENT.has(fulfillmentCode ?? '');
}

export function isCompletedStoreOrder(
  fulfillmentCode: string | null | undefined,
) {
  return COMPLETED_FULFILLMENT.has(fulfillmentCode ?? '');
}

export function isPlacedSalesDocument(status: SalesDocumentStatus) {
  return !NOT_PLACED_SALES_DOCUMENT.has(status);
}

export function isCompletedSalesDocument(status: SalesDocumentStatus) {
  return COMPLETED_SALES_DOCUMENT.has(status);
}

export function isRepeatCustomer(placedOrders: number) {
  return placedOrders >= REPEAT_CUSTOMER_MIN_ORDERS;
}

export interface OrderLineStats {
  placedOrders: number;
  completedPurchases: number;
  /** Latest placed order date, or null. */
  lastOrderDate: Date | null;
}

/** Store-order figures at the top level (repeat label, lookup, duplicates); B2B apart. */
export interface CustomerOrderStats extends OrderLineStats {
  b2b: OrderLineStats;
}

const emptyLine = (): OrderLineStats => ({
  placedOrders: 0,
  completedPurchases: 0,
  lastOrderDate: null,
});

export const EMPTY_ORDER_STATS: CustomerOrderStats = {
  ...emptyLine(),
  b2b: emptyLine(),
};

type StatsClient = Pick<
  Prisma.TransactionClient,
  'storeOrder' | 'salesOrderDocument' | 'statusDefinition'
>;

/** Company-wide counts for each partner (missing partners get zeros). */
export async function customerOrderStats(
  client: StatsClient,
  partnerIds: string[],
): Promise<Map<string, CustomerOrderStats>> {
  const result = new Map<string, CustomerOrderStats>();
  const ids = [...new Set(partnerIds)];
  if (ids.length === 0) return result;
  for (const id of ids) result.set(id, { ...emptyLine(), b2b: emptyLine() });

  const [storeGroups, documentGroups] = await Promise.all([
    client.storeOrder.groupBy({
      by: ['partnerId', 'fulfillmentStatusId'],
      where: { partnerId: { in: ids }, agentId: null, deletedAt: null },
      _count: { _all: true },
      _max: { orderDate: true },
    }),
    client.salesOrderDocument.groupBy({
      by: ['partnerId', 'status'],
      where: { partnerId: { in: ids }, deletedAt: null },
      _count: { _all: true },
      _max: { confirmedAt: true, createdAt: true },
    }),
  ]);
  const statusIds = [
    ...new Set(
      storeGroups.flatMap((row) =>
        row.fulfillmentStatusId ? [row.fulfillmentStatusId] : [],
      ),
    ),
  ];
  const codes = new Map(
    statusIds.length === 0
      ? []
      : (
          await client.statusDefinition.findMany({
            where: { id: { in: statusIds } },
            select: { id: true, code: true },
          })
        ).map((row) => [row.id, row.code]),
  );

  const add = (
    stats: OrderLineStats | undefined,
    count: number,
    placed: boolean,
    completed: boolean,
    date: Date | null,
  ) => {
    if (!stats || !placed) return;
    stats.placedOrders += count;
    if (completed) stats.completedPurchases += count;
    if (date && (!stats.lastOrderDate || date > stats.lastOrderDate)) {
      stats.lastOrderDate = date;
    }
  };
  for (const row of storeGroups) {
    const code = row.fulfillmentStatusId
      ? (codes.get(row.fulfillmentStatusId) ?? null)
      : null;
    add(
      result.get(row.partnerId),
      row._count._all,
      isPlacedStoreOrder(code),
      isCompletedStoreOrder(code),
      row._max.orderDate,
    );
  }
  for (const row of documentGroups) {
    add(
      result.get(row.partnerId)?.b2b,
      row._count._all,
      isPlacedSalesDocument(row.status),
      isCompletedSalesDocument(row.status),
      row._max.confirmedAt ?? row._max.createdAt,
    );
  }
  return result;
}

/** "Product A · Product B +3" — the first two product names and how many more. */
export function productSummary(names: string[]): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return '';
  const head = unique.slice(0, 2).join(' · ');
  return unique.length > 2 ? `${head} +${unique.length - 2}` : head;
}
