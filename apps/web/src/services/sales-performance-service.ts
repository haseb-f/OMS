import { apiClient } from "./api-client";

export type SalesPeriod = "today" | "week" | "month";

export interface SalesPerformanceDashboard {
  period: SalesPeriod;
  scope: "ALL" | "TEAM" | "OWN" | "NONE";
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
    self: { rank: number; orders: number; of: number };
    leaderboard: { rank: number; userId: string | null; displayName: string; orders: number }[];
  };
}

export const salesPerformanceService = {
  dashboard: (period: SalesPeriod = "month") =>
    apiClient.get<SalesPerformanceDashboard>(`/sales/performance?period=${period}`),
};
