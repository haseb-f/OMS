import { apiClient } from "./api-client";

/**
 * R13 spec E — sales reports. The API (`apps/api/src/sales-reports`) owns
 * every metric definition: valid = not cancelled, returned stays a sale,
 * amounts per order currency (never added together), Africa/Cairo days.
 */

export type SalesReportScope = "ALL" | "TEAM" | "OWN" | "NONE" | "AGENT_ALL" | "AGENT_OWN";
export type LivePeriod = "today" | "yesterday" | "last7Days" | "thisMonth" | "lastMonth";
export type RankBy = "count" | "amount";

export interface CurrencyAmount {
  currencyCode: string;
  amount: number;
}

export interface SalesStats {
  orders: number;
  valid: number;
  cancelled: number;
  returned: number;
  amounts: CurrencyAmount[];
}

export interface LiveBucket extends SalesStats {
  period: LivePeriod;
  from: string;
  to: string;
  statusBreakdown: Array<{ code: string; count: number }>;
}

export interface LiveReport {
  scope: SalesReportScope;
  timeZone: string;
  generatedAt: string;
  periods: LiveBucket[];
}

export interface RankedEmployee extends SalesStats {
  rank: number;
  rankValue: number;
  userId: string | null;
  name: string | null;
}

export interface RankedTeam extends SalesStats {
  rank: number;
  rankValue: number;
  teamId: string;
  name: string;
  manager: { userId: string; name: string };
  members: Array<{ userId: string; name: string }>;
}

export interface PaymentMixRow {
  currencyCode: string;
  prepaid: { count: number; amount: number };
  cod: { count: number; amount: number };
}

export interface PerformanceReport {
  scope: SalesReportScope;
  timeZone: string;
  generatedAt: string;
  from: string;
  to: string;
  rankBy: RankBy;
  currency: string | null;
  currencies: string[];
  employees: RankedEmployee[];
  employeesTruncated: boolean;
  teams: RankedTeam[] | null;
  agents: SalesStats | null;
  paymentMix: PaymentMixRow[];
}

export interface PerformanceParams {
  from: string;
  to: string;
  rankBy: RankBy;
  currency?: string | null;
}

/** Where the report is read from: the company API or the agent portal copy. */
export type SalesReportsSource = "company" | "agent";

const BASE: Record<SalesReportsSource, string> = {
  company: "/sales-reports",
  agent: "/agent-portal/sales-reports",
};

export function performanceQuery(params: PerformanceParams): string {
  const query = new URLSearchParams({ from: params.from, to: params.to, rankBy: params.rankBy });
  if (params.rankBy === "amount" && params.currency) query.set("currency", params.currency);
  return query.toString();
}

export const salesReportsService = {
  live: (source: SalesReportsSource) => apiClient.get<LiveReport>(`${BASE[source]}/live`),
  performance: (source: SalesReportsSource, params: PerformanceParams) =>
    apiClient.get<PerformanceReport>(`${BASE[source]}/performance?${performanceQuery(params)}`),
};
