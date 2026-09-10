import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

export type CommissionStatus = "CALCULATED" | "APPROVED" | "INCLUDED_IN_PAYROLL" | "ADJUSTED";

export interface CommissionEmployeeRef {
  id: string;
  employeeCode: string;
  partner: { name: string };
}

export interface CommissionAdjustmentRow {
  id: string;
  originCommissionCalculationId: string;
  targetPeriod: string;
  previousAmount: string;
  newAmount: string;
  amountDelta: string;
  reason: string;
  actorUserId: string;
  createdAt: string;
  appliedToPayrollLineId: string | null;
}

export interface CommissionCalculationRow {
  id: string;
  employeeProfileId: string;
  period: string;
  commissionPlanId: string;
  basisAmount: string;
  targetAmount: string | null;
  achievementPercent: string | null;
  amount: string;
  status: CommissionStatus;
  calculatedAt: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  employeeProfile: CommissionEmployeeRef;
  commissionPlan: { id: string; name: string; ruleType: string; basis: string };
  adjustments: CommissionAdjustmentRow[];
}

export interface CommissionsQueryParams {
  period?: string;
  status?: CommissionStatus;
  employeeProfileId?: string;
  departmentId?: string;
  [key: string]: string | number | boolean | string[] | undefined;
}

const basePath = "/commissions";

/**
 * Part T-X — the Commission Engine's review/approval/adjustment surface
 * (Plan configuration lives in `commission-plans-service`). `list` returns a
 * bare array, same as `sales-targets-service`, per `CommissionsController`.
 */
export const commissionsService = {
  calculate: (dto: { employeeProfileId: string; period: string }) =>
    apiClient.post<CommissionCalculationRow>(`${basePath}/calculate`, dto),
  list: (params: CommissionsQueryParams = {}) =>
    apiClient.get<CommissionCalculationRow[]>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<CommissionCalculationRow>(`${basePath}/${id}`),
  approve: (id: string) => apiClient.post<CommissionCalculationRow>(`${basePath}/${id}/approve`),
  /** Corrects the SAME still-unposted period's calculation — requires a reason, fully audited. */
  adjust: (id: string, dto: { newAmount: number; reason: string }) =>
    apiClient.post<CommissionCalculationRow>(`${basePath}/${id}/adjust`, dto),
  /** Part X — a POSTED payroll's commission is never rewritten; this targets a FUTURE payroll period instead. */
  createFutureAdjustment: (
    id: string,
    dto: { targetPeriod: string; newAmount: number; reason: string },
  ) => apiClient.post<CommissionAdjustmentRow>(`${basePath}/${id}/future-adjustments`, dto),
};
