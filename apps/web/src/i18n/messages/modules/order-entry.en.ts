/** orderEntry namespace (en) — R15 W1 shared order-entry flow (company + agent). */
const orderEntryEn = {
  availability: {
    title: "Some products are short of stock",
    line: "{product}: {requested} ordered, {available} available",
    hint: "The order is still saved — as awaiting stock — and is reserved as soon as stock arrives.",
    available: "Available {count}",
  },
  agent: {
    newOrder: "New agent order",
    staffTitle: "New order for {agent}",
    staffDescription:
      "Entered on the agent's behalf — the agent's catalog, agreement and shipping charge apply.",
    owner: "Order owner",
    ownerHint: "The agent user responsible for this order. Empty: the agent's default owner.",
    leadCustomer: "Customer from lead {number}",
    openLead: "Open lead",
    quotePending: "Wait for the price check before creating the order.",
    quoteInvalid: "Fix the price issues before creating the order.",
    declarationTitle: "Payment received",
    unavailableDestinations: "No payment destination is configured for this agent yet.",
  },
} as const;

export default orderEntryEn;
