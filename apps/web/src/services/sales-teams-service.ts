import { apiClient } from "./api-client";
import { buildQueryString } from "@/lib/query-string";

export interface SalesTeamDepartment {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  isActive: boolean;
  deletedAt: string | null;
}

export interface SalesTeamUser {
  id: string;
  fullName: string;
  username: string;
}

export interface SalesTeamMemberRow {
  id: string;
  userId: string;
  user: SalesTeamUser;
}

export interface SalesTeamRow {
  id: string;
  code: string;
  name: string;
  departmentId: string;
  department: SalesTeamDepartment;
  managerId: string;
  manager: SalesTeamUser;
  notes: string | null;
  members: SalesTeamMemberRow[];
  deletedAt: string | null;
}

export interface SalesTeamPayload {
  name: string;
  departmentId: string;
  managerId: string;
  memberIds?: string[];
  notes?: string;
}

export const salesTeamsService = {
  list: (search?: string) =>
    apiClient.get<SalesTeamRow[]>(`/sales-teams${buildQueryString({ search })}`),
  get: (id: string) => apiClient.get<SalesTeamRow>(`/sales-teams/${id}`),
  create: (dto: SalesTeamPayload) => apiClient.post<SalesTeamRow>("/sales-teams", dto),
  update: (id: string, dto: Partial<SalesTeamPayload>) =>
    apiClient.patch<SalesTeamRow>(`/sales-teams/${id}`, dto),
  archive: (id: string) => apiClient.post<SalesTeamRow>(`/sales-teams/${id}/archive`),
  restore: (id: string) => apiClient.post<SalesTeamRow>(`/sales-teams/${id}/restore`),
};
