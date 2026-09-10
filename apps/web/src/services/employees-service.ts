import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";
import type {
  MasterDataActivityEntry,
  MasterDataListParams,
  MasterDataListResult,
} from "./master-data-service";

export type EmploymentStatus = "ACTIVE" | "INACTIVE" | "TERMINATED";

export interface EmployeeRefLite {
  id: string;
  employeeCode: string;
  name: string;
}

export interface EmployeeRow {
  id: string;
  employeeCode: string;
  name: string;
  mobile: string | null;
  email: string | null;
  notes: string | null;
  hireDate: string | null;
  employmentStatus: EmploymentStatus;
  department: { id: string; name: string; nameEn: string | null } | null;
  jobTitle: { id: string; name: string; nameEn: string | null } | null;
  salesTeam: { id: string; name: string } | null;
  manager: EmployeeRefLite | null;
  userId: string | null;
  userEmail: string | null;
  partnerId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CompensationLineInput {
  payrollComponentId: string;
  amount: number;
}

export interface RecordCompensationPayload {
  effectiveFrom: string;
  basicSalary: number;
  kpiMaxPay?: number;
  notes?: string;
  lines?: CompensationLineInput[];
}

export interface CompensationRevisionLineRow {
  id: string;
  payrollComponentId: string;
  amount: string;
  sortOrder: number;
  payrollComponent: { id: string; nameAr: string; nameEn: string | null; type: string };
}

export interface CompensationRevisionRow {
  id: string;
  employeeProfileId: string;
  effectiveFrom: string;
  basicSalary: string;
  kpiMaxPay: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lines: CompensationRevisionLineRow[];
}

export interface CreateEmployeePayload {
  name: string;
  mobile?: string;
  email?: string;
  hireDate?: string;
  departmentId?: string;
  jobTitleId?: string;
  salesTeamId?: string;
  managerEmployeeId?: string;
  compensation?: RecordCompensationPayload;
  createLoginAccount?: boolean;
  account?: {
    loginEmail: string;
    role: string;
    username?: string;
  };
}

export interface UpdateEmployeePayload {
  name?: string;
  mobile?: string;
  email?: string;
  hireDate?: string;
  employmentStatus?: EmploymentStatus;
  departmentId?: string;
  jobTitleId?: string;
  salesTeamId?: string;
  managerEmployeeId?: string;
}

export interface CreateEmployeeAccountPayload {
  loginEmail: string;
  role: string;
  username?: string;
}

const basePath = "/employees";

export const employeesService = {
  list: (params: MasterDataListParams = {}) =>
    apiClient.get<MasterDataListResult<EmployeeRow>>(`${basePath}${buildQueryString(params)}`),
  get: (id: string) => apiClient.get<EmployeeRow>(`${basePath}/${id}`),
  me: () => apiClient.get<EmployeeRow>(`${basePath}/me`),
  create: (dto: CreateEmployeePayload) => apiClient.post<EmployeeRow>(basePath, dto),
  update: (id: string, dto: UpdateEmployeePayload) =>
    apiClient.patch<EmployeeRow>(`${basePath}/${id}`, dto),
  archive: (id: string) => apiClient.post<EmployeeRow>(`${basePath}/${id}/archive`),
  restore: (id: string) => apiClient.post<EmployeeRow>(`${basePath}/${id}/restore`),
  activity: (id: string) => apiClient.get<MasterDataActivityEntry[]>(`${basePath}/${id}/activity`),
  createAccount: (id: string, dto: CreateEmployeeAccountPayload) =>
    apiClient.post<EmployeeRow>(`${basePath}/${id}/account`, dto),
  compensationHistory: (id: string) =>
    apiClient.get<CompensationRevisionRow[]>(`${basePath}/${id}/compensation`),
  recordCompensation: (id: string, dto: RecordCompensationPayload) =>
    apiClient.post<CompensationRevisionRow>(`${basePath}/${id}/compensation`, dto),
  updateCompensationRevision: (revisionId: string, dto: RecordCompensationPayload) =>
    apiClient.patch<CompensationRevisionRow>(`/employees/compensation/${revisionId}`, dto),
  /** Lightweight search for pickers (KPI/Targets/Commission employee comboboxes) — reuses the same list endpoint, active employees only by default. */
  search: (query: string) =>
    apiClient
      .get<MasterDataListResult<EmployeeRow>>(
        `${basePath}${buildQueryString({ search: query || undefined, pageSize: 20 })}`,
      )
      .then((result) => result.items),
};
