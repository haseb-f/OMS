import { apiClient } from "./api-client";

/** Mirrors `apps/api/src/customer-history/customer-history.service.ts` (Round 14). */

export type HistoryOrderType = "STORE" | "B2B";

export interface CustomerHistoryOrder {
  id: string;
  type: HistoryOrderType;
  number: string;
  date: string;
  productSummary: string;
  products: { name: string; quantity: number }[];
  fulfillmentStatus: { code: string; name: string; nameEn: string | null } | null;
  /** B2B sales order document status. */
  documentStatus: string | null;
  /** Store orders only. */
  paymentStatus: string | null;
  total: number;
  currencyCode: string | null;
}

export type CustomerTimelineKind = "ORDER" | "DELIVERY" | "RETURN" | "CANCELLATION" | "PAYMENT";

export interface CustomerTimelineEvent {
  kind: CustomerTimelineKind;
  at: string;
  reference: string;
  orderId: string | null;
  orderType: HistoryOrderType | null;
  amount?: number;
  currencyCode?: string | null;
}

export interface CustomerOrderStats {
  placedOrders: number;
  completedPurchases: number;
}

/** Store-order figures (the repeat label) — B2B sales orders are counted apart. */
export interface CustomerOrderStatsWithB2b extends CustomerOrderStats {
  b2b: CustomerOrderStats;
}

export interface CustomerHistory {
  partner: { id: string; name: string; partnerNumber: string };
  summary: CustomerOrderStats & {
    lastOrderDate: string | null;
    b2b: CustomerOrderStats & { lastOrderDate: string | null };
  };
  /** Store orders the caller can open. */
  orders: CustomerHistoryOrder[];
  /** Store orders the caller cannot open — a number only. */
  otherOrdersCount: number;
  /** B2B sales orders — their own list, never mixed with the store orders. */
  b2bOrders: CustomerHistoryOrder[];
  otherB2bOrdersCount: number;
  /** Null without `finance.view` / `customers.view_financials`. */
  financials: {
    outstandingBalance: number;
    currencyCode: string | null;
    payments: {
      id: string;
      number: string;
      date: string;
      amount: number;
      currencyCode: string | null;
      status: string;
      orderId: string | null;
      orderNumber: string | null;
    }[];
  } | null;
  timeline: CustomerTimelineEvent[];
}

export const customerHistoryService = {
  history: (partnerId: string) => apiClient.get<CustomerHistory>(`/customers/${partnerId}/history`),
  orderStats: (partnerId: string) =>
    apiClient.get<CustomerOrderStatsWithB2b>(`/customers/${partnerId}/order-stats`),
};

/** Where an order of the history opens. */
export function historyOrderHref(order: { id: string; type: HistoryOrderType }): string {
  return order.type === "STORE" ? `/store-orders/${order.id}` : `/sales/orders/${order.id}`;
}
