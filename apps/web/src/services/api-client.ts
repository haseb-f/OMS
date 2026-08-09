/**
 * Fetch wrapper for the NestJS API (apps/api) — every business service
 * module imports this instead of calling `fetch` directly. Automatically
 * attaches the auth bearer token and the active Company/Branch context
 * (ADR-0022) so every request is scoped correctly without each caller
 * having to remember to do it.
 */
import { getAuthToken, clearAuthToken } from "@/lib/auth-token";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

/** Set by CompanyProvider whenever the active company/branch changes. */
let activeCompanyId: string | null = null;
let activeBranchId: string | null = null;

export function setActiveCompanyContext(companyId: string | null, branchId: string | null) {
  activeCompanyId = companyId;
  activeBranchId = branchId;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAuthToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(activeCompanyId ? { "X-Company-Id": activeCompanyId } : {}),
    ...(activeBranchId ? { "X-Branch-Id": activeBranchId } : {}),
    ...extra,
  };
}

async function requestRaw(path: string, init?: RequestInit): Promise<Response> {
  const headers = authHeaders(init?.headers as Record<string, string> | undefined);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (response.status === 401 && typeof window !== "undefined") {
    clearAuthToken();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new ApiError(response.status, body?.message ?? response.statusText);
  }

  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await requestRaw(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /** Multipart upload — no Content-Type header, so the browser sets the multipart boundary itself. */
  postForm: async <T>(path: string, formData: FormData): Promise<T> => {
    const response = await requestRaw(path, { method: "POST", body: formData });
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
  },
  /** Raw file download (e.g. a CSV export streamed by the API). */
  getBlob: async (path: string): Promise<Blob> => {
    const response = await requestRaw(path);
    return response.blob();
  },
};
