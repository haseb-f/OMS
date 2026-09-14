/**
 * Fetch wrapper for the Investor Portal's own API surface
 * (`/investor-portal/*`) — deliberately a SEPARATE client from the internal
 * admin `apiClient` (mission Part 18/22/52). It reads/writes the Portal's
 * own cookie (`investor-portal-token.ts`, not `auth-token.ts`) and, on a
 * 401, redirects to `/investor/login` — never the internal `/login`. Every
 * Investor Portal page/service must import THIS client, never the internal
 * `apiClient`.
 *
 * Reuses the internal `ApiError` class (a plain data-shape class, not an
 * auth-coupled one) so the shared `reportApiError`/`toast` helpers in
 * `lib/toast.ts` keep working uniformly across both boundaries.
 */
import { ApiError, type ErrorCode, type ErrorFieldDetail } from "@/services/api-client";
import { getInvestorPortalToken, clearInvestorPortalToken } from "@/lib/investor-portal-token";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import { defaultLocale, type Locale } from "@/i18n/locales";
import { STORAGE_KEYS } from "@/constants/storage-keys";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface StructuredErrorBody {
  code?: ErrorCode;
  message?: string;
  fields?: ErrorFieldDetail[];
}

function currentLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEYS.locale);
    if (stored) return JSON.parse(stored) as Locale;
  } catch {
    // Corrupt/inaccessible storage — fall back to the default locale.
  }
  return defaultLocale;
}

function codeForStatus(status: number): ErrorCode {
  if (status === 401 || status === 403) return "PERMISSION_ERROR";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "DUPLICATE";
  if (status >= 500) return "SERVER_ERROR";
  return "VALIDATION_ERROR";
}

function friendlyMessage(code: ErrorCode, rawMessage: string | undefined, locale: Locale): string {
  const dict = messages[locale];
  // Portal error messages are always hand-authored, already-readable
  // BadRequestException/UnauthorizedException strings (login/activation
  // failures, IDOR 404s) — never a class-validator field-constraint dump —
  // so they're shown as-is when present, exactly like the internal
  // client's `fields === undefined` branch.
  if (rawMessage) return rawMessage;
  return translate(dict, `errors.${code}` as MessageKey);
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getInvestorPortalToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function requestRaw(path: string, init?: RequestInit): Promise<Response> {
  const headers = authHeaders(init?.headers as Record<string, string> | undefined);
  const locale = currentLocale();

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch (error) {
    console.error(`[investor-portal-api-client] network error on ${path}`, error);
    throw new ApiError(0, translate(messages[locale], "errors.NETWORK_ERROR"), "NETWORK_ERROR");
  }

  if (response.status === 401 && typeof window !== "undefined") {
    clearInvestorPortalToken();
    if (!window.location.pathname.startsWith("/investor/login")) {
      window.location.href = "/investor/login";
    }
  }

  if (!response.ok) {
    const body: StructuredErrorBody | undefined = await response.json().catch(() => undefined);
    const code = body?.code ?? codeForStatus(response.status);
    console.error(
      `[investor-portal-api-client] ${response.status} ${code} on ${path}:`,
      body?.message,
    );
    const message = friendlyMessage(code, body?.message, locale);
    throw new ApiError(response.status, message, code, body?.fields);
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

export const investorPortalApiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  /**
   * Authenticated file download — a plain `<a href>` can't carry the
   * Bearer header, so the caller fetches the bytes as a Blob and opens/
   * downloads it via an object URL (mirrors `apiClient.getBlob`).
   */
  getBlob: async (path: string): Promise<Blob> => {
    const response = await requestRaw(path);
    return response.blob();
  },
};
