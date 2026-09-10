import { apiClient } from "./api-client";
import type { PayrollComponentType } from "./payroll-components-service";

export type PayrollRunStatus = "DRAFT" | "HR_REVIEWED" | "FINANCE_APPROVED" | "POSTED" | "PAID";

export interface PayrollLineComponentRow {
  id: string;
  payrollLineId: string;
  payrollComponentId: string | null;
  label: string;
  type: PayrollComponentType;
  amount: string;
  sortOrder: number;
  payrollComponent: {
    id: string;
    nameAr: string;
    nameEn: string | null;
    type: PayrollComponentType;
  } | null;
}

export interface PayrollLineEmployeeProfile {
  id: string;
  employeeCode: string;
  partner: { name: string };
}

export interface PayrollLineRow {
  id: string;
  payrollRunId: string;
  employeeProfileId: string;
  basicSalary: string;
  kpiPay: string;
  commission: string;
  allowances: string;
  otherEarnings: string;
  deductions: string;
  grossEarnings: string;
  netPay: string;
  kpiEvaluationId: string | null;
  commissionCalculationId: string | null;
  employeeProfile: PayrollLineEmployeeProfile;
  components: PayrollLineComponentRow[];
}

export interface PayrollRunRow {
  id: string;
  period: string;
  status: PayrollRunStatus;
  hrReviewedByUserId: string | null;
  hrReviewedAt: string | null;
  financeApprovedByUserId: string | null;
  financeApprovedAt: string | null;
  postedByUserId: string | null;
  postedAt: string | null;
  paidByUserId: string | null;
  paidAt: string | null;
  grossEarnings: string;
  totalDeductions: string;
  netPay: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  /** Present only on `get` — `list` returns bare run rows with no lines. */
  lines?: PayrollLineRow[];
}

export interface AddPayrollLineComponentPayload {
  payrollComponentId: string;
  amount: number;
}

const basePath = "/payroll";

export const payrollService = {
  list: () => apiClient.get<PayrollRunRow[]>(basePath),
  get: (id: string) => apiClient.get<PayrollRunRow>(`${basePath}/${id}`),
  createRun: (period: string) => apiClient.post<PayrollRunRow>(basePath, { period }),
  recalculate: (id: string) => apiClient.post<PayrollRunRow>(`${basePath}/${id}/recalculate`),
  addLineComponent: (lineId: string, dto: AddPayrollLineComponentPayload) =>
    apiClient.post<PayrollRunRow>(`${basePath}/lines/${lineId}/components`, dto),
  hrReview: (id: string) => apiClient.post<PayrollRunRow>(`${basePath}/${id}/hr-review`),
  financeApprove: (id: string) =>
    apiClient.post<PayrollRunRow>(`${basePath}/${id}/finance-approve`),
  post: (id: string) => apiClient.post<PayrollRunRow>(`${basePath}/${id}/post`),
  pay: (id: string) => apiClient.post<PayrollRunRow>(`${basePath}/${id}/pay`),
};
