/** customerHistory namespace (en) — Round 14 customer history, repeat-customer badge and the full-disclosure card. */
const customerHistoryEn = {
  repeat: {
    label: "Repeat customer · {count} orders",
    tooltip: "{count} completed purchases",
  },
  card: {
    latestOrder: "Latest order",
    noOrders: "No orders yet",
    placedOrders: "{count} orders",
  },
  tabs: {
    orders: "Orders",
    leads: "Leads",
    history: "Timeline",
  },
  summary: {
    placed: "Orders",
    completed: "Completed purchases",
    lastOrder: "Last order",
    outstanding: "Outstanding balance",
  },
  orders: {
    empty: "This customer has no orders.",
    otherOrders: "{count} more orders with other employees",
    loadFailed: "Could not load the customer's orders.",
    columns: {
      number: "Order",
      date: "Date",
      products: "Products",
      fulfillment: "Fulfillment",
      payment: "Payment",
      total: "Total",
    },
    type: {
      STORE: "Store order",
      B2B: "Sales order",
    },
  },
  leads: {
    empty: "No leads are linked to this customer.",
  },
  payments: {
    title: "Order collections",
    empty: "No payments are recorded on this customer's orders.",
    order: "Order",
  },
  timeline: {
    empty: "No events yet.",
    kind: {
      ORDER: "New order",
      DELIVERY: "Delivered",
      RETURN: "Returned",
      CANCELLATION: "Order cancelled",
      PAYMENT: "Payment received",
    },
  },
} as const;

export default customerHistoryEn;
