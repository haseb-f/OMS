import { apiClient } from "./api-client";

export interface UserRow {
  id: string;
  email: string;
  username: string;
  fullName: string;
  mobile: string | null;
  department: string | null;
  isActive: boolean;
  isLocked: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  jobTitleId: string | null;
  jobTitle: { id: string; name: string } | null;
  branchId: string | null;
  branch: { id: string; name: string; code: string } | null;
}

export interface UserFormPayload {
  email?: string;
  username?: string;
  fullName?: string;
  password?: string;
  mobile?: string;
  department?: string;
  jobTitleId?: string;
  branchId?: string;
  isActive?: boolean;
}

export interface UserPermissionsResult {
  granted: string[];
}

/**
 * TASK-060 — Users & Permissions. `list()`/`UserRow`'s original fields
 * (id/email/fullName/isActive) are unchanged — every existing "assign a
 * person" select (Warehouse Manager, createdBy filters, ...) keeps working
 * unmodified; every field below is additive.
 */
export const usersService = {
  list: (search?: string) =>
    apiClient.get<UserRow[]>(`/users${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  get: (id: string) => apiClient.get<UserRow>(`/users/${id}`),
  create: (dto: UserFormPayload) => apiClient.post<UserRow>("/users", dto),
  update: (id: string, dto: UserFormPayload) => apiClient.patch<UserRow>(`/users/${id}`, dto),
  remove: (id: string) => apiClient.delete<UserRow>(`/users/${id}`),
  lock: (id: string) => apiClient.post<UserRow>(`/users/${id}/lock`),
  unlock: (id: string) => apiClient.post<UserRow>(`/users/${id}/unlock`),
  resetPassword: (id: string, newPassword: string) =>
    apiClient.post<UserRow>(`/users/${id}/reset-password`, { newPassword }),
  forcePasswordChange: (id: string) =>
    apiClient.post<UserRow>(`/users/${id}/force-password-change`),
  getPermissions: (id: string) => apiClient.get<UserPermissionsResult>(`/users/${id}/permissions`),
  setPermissions: (id: string, permissionNames: string[]) =>
    apiClient.post<UserPermissionsResult>(`/users/${id}/permissions`, { permissionNames }),
};
