import { apiClient } from "./api-client";

export type SalesPeriod = "today" | "week" | "month";

export interface SalesPerformanceDashboard {
  period: SalesPeriod;
  /** The report scope (R15 D15-18): ALL only with `reports.sales.view_all`. */
  scope: "ALL" | "TEAM" | "OWN";
  kpis: {
    newLeads: number;
    inProgress: number;
    followUp: number;
    dueToday: number;
    overdue: number;
    converted: number;
    orders: number;
    delivered: number;
    conversionRate: number;
  };
  ranking: {
    /** Own company position (null = no order in the period) and valid orders. */
    self: { rank: number | null; orders: number; of: number };
    /** The caller's scope ranked within itself; always empty for OWN. */
    leaderboard: { rank: number; userId: string; displayName: string; orders: number }[];
  };
}

export const salesPerformanceService = {
  dashboard: (period: SalesPeriod = "month") =>
    apiClient.get<SalesPerformanceDashboard>(`/sales/performance?period=${period}`),
};
