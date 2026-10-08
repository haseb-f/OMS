/** agentOverview namespace (en) — R15 W1 agent overview cards. */
const agentOverviewEn = {
  delivered: "Delivered value",
  deliveredContext: "{count} delivered orders",
  returnCount: "Returns",
  leads: "Leads",
  leadsValue: "{total} · {converted} converted",
  ownSalesTitle: "My sales",
  loadFailed: "Could not load the overview.",
  team: {
    title: "By employee",
    description: "Each user's orders, leads and sales",
    inactive: "inactive",
    unassigned: "Unassigned",
  },
  agents: {
    title: "Agents overview",
    description: "Every agent now; the cards below cover the agents on this page of the list.",
    activeAgents: "Active agents",
    agentsContext: "{total} agents in total",
    openOrders: "Open orders",
    openOrdersContext: "Not yet completed or cancelled",
    withReturns: "Orders with returns",
    leads: "Leads",
    leadsContext: "{count} new",
    awaitingVerification: "Payments awaiting Finance",
    byAgentTitle: "By agent",
    availableForPayout: "Available for payout",
  },
} as const;

export default agentOverviewEn;
