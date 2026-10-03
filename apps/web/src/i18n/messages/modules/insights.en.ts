/** insights namespace (en) — Round 6 dashboards: figure scopes and period-free tile context. */
const insightsEn = {
  scope: {
    current: "Now",
    toDate: "To date",
    pace: "Today · week · month",
  },
  company: {
    salesScope: "Within your access",
    newLeads: "Not yet worked",
    converted: "Turned into orders",
    conversion: "Of leads created",
    delivered: "Delivered to customers",
    ranking: "Orders created, cancelled excluded",
    inProgress: "Not period-bound",
  },
  agent: {
    ordersTitle: "Orders and fulfillment",
    ordersOwn: "Your orders",
    ordersAll: "All agent orders",
    stageShare: "{percent}% of orders",
    leadsTitle: "Leads",
    leadsAll: "All leads",
    leadsNew: "New",
    leadsNewContext: "Not yet worked",
    leadsConverted: "Converted",
    leadsConvertedContext: "Turned into orders",
    salesTitle: "Sales and collections",
    positionTitle: "Statement position",
    openStatement: "Open statement",
    openPayouts: "Payouts",
    viewOrders: "View orders",
    viewLeads: "View leads",
    collectionsContext: "{count} payments awaiting Finance",
  },
} as const;

export default insightsEn;
