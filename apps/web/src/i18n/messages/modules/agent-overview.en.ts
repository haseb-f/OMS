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
    description: "How all agents stand now, then each agent's own figures.",
    activeAgents: "Active agents",
    agentsContext: "{total} agents in total",
    openOrders: "Open orders",
    openOrdersContext: "Not yet completed or cancelled",
    withReturns: "Orders with returns",
    leads: "Leads",
    leadsContext: "{count} new",
    awaitingVerification: "Payments awaiting Finance",
    byAgentTitle: "By agent",
    byAgentDescription:
      "Each agent's figures in its own currency; open a card for the agent's page.",
    availableForPayout: "Available for payout",
  },
} as const;

export default agentOverviewEn;
