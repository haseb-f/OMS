import { apiClient } from "./api-client";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  /** Returned by `POST /auth/login` — lets the login page land on the right audience's home (R6 A.4). */
  userType?: "INTERNAL" | "AGENT";
}

export interface CompanyBranch {
  id: string;
  name: string;
  code: string;
}

export interface CompanyContext {
  id: string;
  name: string;
  code: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  branches: CompanyBranch[];
  defaultBranchId: string | null;
}

export interface CurrentUser extends AuthUser {
  username: string;
  jobTitle: string | null;
  mustChangePassword: boolean;
  /** TASK-060 — always empty; Role/RBAC no longer exists. Kept only so any stale read of `user.roles` degrades safely. */
  roles: string[];
  /** System-level bypass, orthogonal to `permissions` — not a role. A super admin passes every `hasPermission()` check regardless of individual grants. */
  isSuperAdmin: boolean;
  permissions: string[];
  companies: CompanyContext[];
  /** Agents milestone — INTERNAL (company staff) or AGENT (an external agent's user). */
  userType?: "INTERNAL" | "AGENT";
  agentRole?: "ADMIN" | "SALES" | null;
  /** The agent an AGENT user belongs to (null for internal users). */
  agent?: { id: string; agentNumber: string; name: string } | null;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export const authService = {
  login: (email: string, password: string) =>
    apiClient.post<LoginResponse>("/auth/login", { email, password }),
  logout: () => apiClient.post<{ message: string }>("/auth/logout"),
  forgotPassword: (email: string) =>
    apiClient.post<{ message: string }>("/auth/forgot-password", { email }),
  resetPassword: (token: string, newPassword: string) =>
    apiClient.post<{ message: string }>("/auth/reset-password", { token, newPassword }),
  me: () => apiClient.get<CurrentUser>("/auth/me"),
  /** Own password change (internal + agent users); clears `mustChangePassword`. */
  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post<{ message: string }>("/auth/change-password", { currentPassword, newPassword }),
};
