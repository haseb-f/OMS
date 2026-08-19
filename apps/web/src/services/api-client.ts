/**
 * Fetch wrapper for the NestJS API (apps/api) — every business service
 * module imports this instead of calling `fetch` directly. Automatically
 * attaches the auth bearer token and the active Company/Branch context
 * (ADR-0022) so every request is scoped correctly without each caller
 * having to remember to do it.
 */
import { getAuthToken, clearAuthToken } from "@/lib/auth-token";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import { defaultLocale, type Locale } from "@/i18n/locales";
import { STORAGE_KEYS } from "@/constants/storage-keys";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

/** Set by CompanyProvider whenever the active company/branch changes. */
let activeCompanyId: string | null = null;
let activeBranchId: string | null = null;

export function setActiveCompanyContext(companyId: string | null, branchId: string | null) {
  activeCompanyId = companyId;
  activeBranchId = branchId;
}

/** Mirrors `apps/api/src/common/errors/error-response.types.ts` — the one envelope every API error response uses. */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "PERMISSION_ERROR"
  | "NOT_FOUND"
  | "DUPLICATE"
  | "SERVER_ERROR"
  | "DATABASE_ERROR"
  | "DEPENDENCY_ERROR"
  | "NETWORK_ERROR"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_DISABLED"
  | "ACCOUNT_LOCKED";

export interface ErrorFieldDetail {
  field: string;
  constraints: string[];
}

interface StructuredErrorBody {
  code?: ErrorCode;
  message?: string;
  fields?: ErrorFieldDetail[];
}

/**
 * `apiClient` is a plain module, not a React component, so it can't call
 * `useLocale()` — reads the same localStorage key that `LocaleProvider`
 * persists to instead. Safe to read outside React: it's synchronous,
 * read-only, and only ever affects which language an error message renders
 * in, never app state.
 */
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

/**
 * Turns `{code, message, fields}` into the one string every existing
 * `toast.error(error.message)` call site already shows — never a raw
 * class-validator/Prisma string. A field the backend identified (e.g.
 * `revenueAccountId`) gets its friendly label from `errors.fields.*` when
 * known; every branch still answers "what happened" and "what to do".
 *
 * `fields === undefined` (as opposed to `[]`) is the signal that this
 * response did NOT come from the generated validation/Prisma paths — it's a
 * hand-written `BadRequestException('...')` from a business rule elsewhere
 * in the service layer. Those are deliberately-authored, already-readable
 * messages, so they're shown as-is instead of being flattened into a
 * generic translation.
 */
function friendlyMessage(
  code: ErrorCode,
  rawMessage: string | undefined,
  fields: ErrorFieldDetail[] | undefined,
  locale: Locale,
): string {
  const dict = messages[locale];
  if (code === "VALIDATION_ERROR" && fields === undefined && rawMessage) {
    return rawMessage;
  }

  // A multi-field "can't activate yet" batch (see `ProductsService.
  // assertActivationReady`) — every field shares this one constraint, so
  // list them all instead of only naming the first one.
  if (
    code === "VALIDATION_ERROR" &&
    fields &&
    fields.length > 0 &&
    fields.every((f) => f.constraints.includes("required_for_activation"))
  ) {
    const fieldDict = dict.errors.fields as Record<string, string | undefined>;
    const labels = [...new Set(fields.map((f) => fieldDict[f.field] ?? f.field))];
    return translate(dict, "errors.activationBlocked", { fields: labels.join("، ") });
  }

  const primaryField = fields?.[0]?.field;
  const label = primaryField
    ? (dict.errors.fields as Record<string, string | undefined>)[primaryField]
    : undefined;
  if (code === "DUPLICATE" && primaryField === "email") {
    return translate(dict, "errors.DUPLICATE_EMAIL");
  }
  if (label && (code === "VALIDATION_ERROR" || code === "DUPLICATE")) {
    return translate(dict, `errors.${code}_FIELD` as MessageKey, { field: label });
  }
  if (code === "DUPLICATE" && !label && rawMessage) {
    return rawMessage;
  }
  return translate(dict, `errors.${code}` as MessageKey);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: ErrorCode = "SERVER_ERROR",
    public readonly fields?: ErrorFieldDetail[],
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
  const locale = currentLocale();

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch (error) {
    // The request never reached the server (offline, DNS, CORS, etc.) — no
    // status code to key off of, so this is always NETWORK_ERROR.
    console.error(`[api-client] network error on ${path}`, error);
    throw new ApiError(0, translate(messages[locale], "errors.NETWORK_ERROR"), "NETWORK_ERROR");
  }

  if (response.status === 401 && typeof window !== "undefined") {
    clearAuthToken();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }

  if (!response.ok) {
    const body: StructuredErrorBody | undefined = await response.json().catch(() => undefined);
    const code = body?.code ?? codeForStatus(response.status);
    // The technical detail (constraint names, the original English message)
    // stays in the console for developers — never in the toast the user sees.
    console.error(
      `[api-client] ${response.status} ${code} on ${path}:`,
      body?.message,
      body?.fields,
    );
    const message = friendlyMessage(code, body?.message, body?.fields, locale);
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
