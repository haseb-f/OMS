import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

export type TargetScopeType = "EMPLOYEE" | "TEAM";
export type TargetMetric = "SALES_REVENUE" | "COLLECTED_SALES" | "ORDERS_COUNT";

export interface SalesTargetEmployeeRef {
  id: string;
  employeeCode: string;
  partner: { name: string };
}

/** Mirrors `SalesTargetsService.findAll`'s include (employeeProfile+partner, salesTeam) — `findOne`/create/update return the bare row (no relations), so those fields stay optional. */
export interface SalesTargetRow {
  id: string;
  period: string;
  scopeType: TargetScopeType;
  employeeProfileId: string | null;
  salesTeamId: string | null;
  metric: TargetMetric;
  targetAmount: string;
  createdAt: string;
  updatedAt: string;
  employeeProfile?: SalesTargetEmployeeRef | null;
  salesTeam?: { id: string; name: string } | null;
}

export interface CreateSalesTargetPayload {
  period: string;
  scopeType: TargetScopeType;
  employeeProfileId?: string;
  salesTeamId?: string;
  metric?: TargetMetric;
  targetAmount: number;
}

/** Only `targetAmount` is editable — period/scope/metric identify the row (Part Q). */
export interface UpdateSalesTargetPayload {
  targetAmount: number;
}

export interface SalesTargetsQueryParams {
  period?: string;
  scopeType?: TargetScopeType;
  metric?: TargetMetric;
  departmentId?: string;
  salesTeamId?: string;
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface RankingRow {
  employeeProfileId: string;
  employeeCode: string;
  name: string;
  targetAmount: number;
  actual: number;
  achievementPercent: number;
  rank: number;
}

export interface RankingResult {
  period: string;
  metric: TargetMetric;
  total: number;
  leaderboard: RankingRow[];
}

export interface RankingQueryParams {
  period?: string;
  metric?: TargetMetric;
  departmentId?: string;
  salesTeamId?: string;
  [key: string]: string | number | boolean | string[] | undefined;
}

/** `SalesTargetsService.myRanking` — two possible shapes depending on whether the caller resolves onto this period's ranked leaderboard. */
export interface MyRankingResult {
  employeeProfileId: string;
  employeeCode?: string;
  name?: string;
  period?: string;
  metric?: TargetMetric;
  targetAmount: number;
  actual: number;
  achievementPercent: number | null;
  targetSource?: "EMPLOYEE" | "TEAM" | null;
  rank: number | null;
  of: number;
}

const basePath = "/sales-targets";

/** Part Q-S — Monthly Sales Targets (Employee or Team scoped) + the canonical Ranking/Achievement calculation, computed server-side from verified financial data (never derived here). `findAll` returns a bare array — no pagination wrapper, per `SalesTargetsController`. */
export const salesTargetsService = {
  list: (params: SalesTargetsQueryParams = {}) =>
    apiClient.get<SalesTargetRow[]>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<SalesTargetRow>(`${basePath}/${id}`),
  create: (dto: CreateSalesTargetPayload) => apiClient.post<SalesTargetRow>(basePath, dto),
  update: (id: string, dto: UpdateSalesTargetPayload) =>
    apiClient.patch<SalesTargetRow>(`${basePath}/${id}`, dto),
  remove: (id: string) => apiClient.delete<{ id: string }>(`${basePath}/${id}`),
  ranking: (params: RankingQueryParams = {}) =>
    apiClient.get<RankingResult>(`${basePath}/ranking${buildQueryString(params)}`),
  /** Part S "ترتيبك #3" — every authenticated employee may see their own rank, unguarded. */
  myRanking: (params: { period?: string; metric?: TargetMetric } = {}) =>
    apiClient.get<MyRankingResult>(`${basePath}/me${buildQueryString(params)}`),
};
