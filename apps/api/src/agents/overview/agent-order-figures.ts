import type { Prisma } from '@prisma/client';
import {
  storeOrderLineAmount,
  storeOrderPayableTotal,
} from '../../store-orders/store-order-line-amount';
import {
  agentFulfillmentFacts,
  aggregateAgentFulfillment,
} from '../common/agent-terms';
import { fromMinor, toMinor } from '../finance/agent-ledger.math';

/**
 * The order columns behind every agent order figure — the internal agent
 * dashboard, the agent portal dashboard and the agent overviews (R15 W1).
 * Read once per request; the figures below are pure.
 */
export const AGENT_ORDER_FIGURES_SELECT = {
  agentId: true,
  employeeId: true,
  agentDispatchedAt: true,
  agentEarnedAt: true,
  currencyId: true,
  merchandiseAmount: true,
  payableTotal: true,
  shippingCharge: true,
  agentTermsSnapshot: true,
  fulfillmentStatus: { select: { code: true } },
  items: {
    where: { deletedAt: null },
    select: {
      quantity: true,
      unitPrice: true,
      agreedAmount: true,
      productId: true,
      product: { select: { isInventoryItem: true, supplyMethod: true } },
    },
  },
  _count: { select: { agentReturns: true } },
} satisfies Prisma.StoreOrderSelect;

export type AgentOrderFiguresRow = Prisma.StoreOrderGetPayload<{
  select: typeof AGENT_ORDER_FIGURES_SELECT;
}>;

/** Fulfillment codes of an order the customer received (delivered, then collected). */
const DELIVERED_CODES: ReadonlySet<string> = new Set([
  'DELIVERED',
  'COLLECTED',
]);

const sumMoney = (values: number[]) =>
  fromMinor(values.reduce((sum, value) => sum + toMinor(value), 0));

const merchandiseOf = (order: AgentOrderFiguresRow) =>
  order.merchandiseAmount != null
    ? Number(order.merchandiseAmount)
    : order.items.reduce((sum, item) => sum + storeOrderLineAmount(item), 0);

export interface AgentOrderFigures {
  fulfillment: ReturnType<typeof aggregateAgentFulfillment>;
  /** Not-cancelled orders in the agent's currency (amounts are never summed across currencies). */
  sales: {
    merchandiseSalesExShipping: number;
    customerShippingCharges: number;
    totalOrderValue: number;
  };
  /** Orders the customer received (DELIVERED / COLLECTED), agent currency. */
  delivered: { count: number; value: number };
  /** Agent returns recorded against the not-cancelled orders. */
  returnCount: number;
}

/**
 * Order figures of a set of agent orders: fulfillment buckets (the shared
 * `aggregateAgentFulfillment`), sales, delivered value and returns. Money is
 * summed in minor units and only for orders in `currencyId` (the agent's
 * currency).
 */
export function agentOrderFigures(
  orders: AgentOrderFiguresRow[],
  currencyId: string,
): AgentOrderFigures {
  const active = orders.filter(
    (order) => order.fulfillmentStatus?.code !== 'CANCELLED',
  );
  const inCurrency = active.filter((order) => order.currencyId === currencyId);
  const delivered = inCurrency.filter((order) =>
    DELIVERED_CODES.has(order.fulfillmentStatus?.code ?? ''),
  );
  return {
    fulfillment: aggregateAgentFulfillment(orders.map(agentFulfillmentFacts)),
    sales: {
      merchandiseSalesExShipping: sumMoney(inCurrency.map(merchandiseOf)),
      customerShippingCharges: sumMoney(
        inCurrency.map((order) => Number(order.shippingCharge ?? 0)),
      ),
      totalOrderValue: sumMoney(
        inCurrency.map((order) => storeOrderPayableTotal(order)),
      ),
    },
    delivered: {
      count: delivered.length,
      value: sumMoney(delivered.map((order) => storeOrderPayableTotal(order))),
    },
    returnCount: active.reduce(
      (sum, order) => sum + order._count.agentReturns,
      0,
    ),
  };
}

/** Lead counts of one scope: every lead, the new ones and the converted ones. */
export interface LeadCounts {
  total: number;
  fresh: number;
  converted: number;
}

export const emptyLeadCounts = (): LeadCounts => ({
  total: 0,
  fresh: 0,
  converted: 0,
});

/** Sum of grouped lead counts (one agent's total from its per-employee groups). */
export function sumLeadCounts(groups: Iterable<LeadCounts>): LeadCounts {
  const sum = emptyLeadCounts();
  for (const counts of groups) {
    sum.total += counts.total;
    sum.fresh += counts.fresh;
    sum.converted += counts.converted;
  }
  return sum;
}

export interface TeamMember {
  id: string;
  fullName: string;
  isActive: boolean;
}

/**
 * Per-employee breakdown of one agent (agent admin team view, company agent
 * overview): every member of the agent, plus one unassigned row when orders or
 * leads have no owner. Money (order value, delivered value) only with `money`.
 */
export function teamBreakdown(
  members: readonly TeamMember[],
  orders: AgentOrderFiguresRow[],
  leads: Map<string | null, LeadCounts>,
  currencyId: string,
  /** `leads: false` omits the per-employee lead counts (caller without lead visibility). */
  options: { money: boolean; leads?: boolean },
) {
  const byEmployee = groupBy(orders, (order) => order.employeeId);
  const memberIds = new Set(members.map((member) => member.id));
  const unassignedOrders = orders.filter(
    (order) => !order.employeeId || !memberIds.has(order.employeeId),
  );
  const unassignedLeads = sumLeadCounts(
    [...leads.entries()]
      .filter(([id]) => !id || !memberIds.has(id))
      .map(([, counts]) => counts),
  );
  const row = (
    user: TeamMember | null,
    rows: AgentOrderFiguresRow[],
    leadCounts: LeadCounts,
  ) => {
    const figures = agentOrderFigures(rows, currencyId);
    return {
      user,
      fulfillment: figures.fulfillment,
      returnCount: figures.returnCount,
      ...(options.leads === false ? {} : { leads: leadCounts }),
      ...(options.money
        ? {
            sales: {
              orderValue: figures.sales.totalOrderValue,
              deliveredValue: figures.delivered.value,
              deliveredCount: figures.delivered.count,
            },
          }
        : {}),
    };
  };
  return [
    ...members.map((member) =>
      row(
        member,
        byEmployee.get(member.id) ?? [],
        leads.get(member.id) ?? emptyLeadCounts(),
      ),
    ),
    ...(unassignedOrders.length > 0 || unassignedLeads.total > 0
      ? [row(null, unassignedOrders, unassignedLeads)]
      : []),
  ];
}

/** Rows grouped by a key (agent, employee) — one query feeds every breakdown row. */
export function groupBy<T>(
  rows: readonly T[],
  key: (row: T) => string | null,
): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}
