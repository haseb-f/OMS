import { apiClient } from "@/services/api-client";
import { buildQueryString } from "@/lib/query-string";
import {
  agentPortalService,
  type CurrencyRef,
  type PortalDashboard,
  type PortalFulfillmentCounts,
} from "@/services/agent-portal-service";
import type { AgentPosition } from "@/services/agents-service";

/**
 * Agent overview data (R15 W1): the company overviews (`GET /agents-overview`,
 * `GET /agents/:id/overview`) and the portal dashboard's R15 additions. Money
 * blocks are ABSENT (not zero) when the caller may not see them — the panels
 * hide what is missing.
 */
export interface LeadCounts {
  total: number;
  fresh: number;
  converted: number;
}

export interface OverviewSales {
  merchandiseSalesExShipping: number;
  customerShippingCharges: number;
  totalOrderValue: number;
}

export interface OverviewCollections {
  awaitingVerificationCount: number;
  awaitingVerificationAmount: number;
}

export interface TeamBreakdownRow {
  /** null = orders / leads without an owner among the agent's users. */
  user: { id: string; fullName: string; isActive: boolean } | null;
  fulfillment: PortalFulfillmentCounts;
  returnCount: number;
  /** Absent when the viewer cannot see leads (agent users without `agent.leads.view`). */
  leads?: LeadCounts;
  sales?: { orderValue: number; deliveredValue: number; deliveredCount: number };
}

export interface OverviewAgentRef {
  id: string;
  agentNumber: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  currency: CurrencyRef | null;
}

/** `GET /agents/:id/overview` — one agent (company Overview tab). */
export interface AgentOverview {
  agent: OverviewAgentRef;
  finance: boolean;
  fulfillment: PortalFulfillmentCounts;
  returnCount: number;
  leads: LeadCounts;
  sales?: OverviewSales;
  delivered?: { count: number; value: number };
  returns?: { merchandiseReturned: number };
  collections?: OverviewCollections;
  position?: AgentPosition;
  payouts?: {
    count: number;
    total: number;
    last: { id: string; payoutNumber: string; amount: number | string; payoutDate: string } | null;
  };
  team?: TeamBreakdownRow[];
}

/** One agent of `GET /agents-overview`. */
export interface AgentsOverviewRow {
  agent: OverviewAgentRef;
  fulfillment: PortalFulfillmentCounts;
  returnCount: number;
  leads: LeadCounts;
  sales?: OverviewSales;
  delivered?: { count: number; value: number };
  collections?: OverviewCollections;
  position?: AgentPosition;
}

export interface AgentsOverview {
  finance: boolean;
  /** Company-wide counts (never money summed across currencies). */
  totals: {
    agents: { total: number; active: number };
    orders: { open: number; withReturns: number };
    leads: LeadCounts;
    collections?: { awaitingVerificationCount: number };
  };
  items: AgentsOverviewRow[];
}

/** `GET /agent-portal/dashboard` with the R15 additions (`own`, `leads`, `team`). */
export interface AgentPortalDashboard extends PortalDashboard {
  leads: LeadCounts | null;
  own: {
    orderValue: number;
    deliveredValue: number;
    deliveredCount: number;
    returnCount: number;
  } | null;
  team: TeamBreakdownRow[] | null;
}

export const agentOverviewApi = {
  /** Company-wide counts + the figures of the agents on the caller's list page. */
  agents: (ids: readonly string[]) =>
    apiClient.get<AgentsOverview>(
      `/agents-overview${buildQueryString({ ids: ids.length > 0 ? ids.join(",") : undefined })}`,
    ),
  agent: (agentId: string) => apiClient.get<AgentOverview>(`/agents/${agentId}/overview`),
  /** The portal service's dashboard call, read with its R15 fields. */
  portalDashboard: () => agentPortalService.dashboard() as Promise<AgentPortalDashboard>,
};
