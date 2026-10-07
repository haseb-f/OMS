/**
 * Fetch wrapper for the NestJS API (apps/api) — every business service
 * module imports this instead of calling `fetch` directly. Automatically
 * attaches the auth bearer token and the active Company/Branch context
 * (ADR-0022) so every request is scoped correctly without each caller
 * having to remember to do it.
 */
import { getAuthToken, clearAuthToken, isSigningOut } from "@/lib/auth-token";
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
  | "ACCOUNT_LOCKED"
  | "MISSING_EXCHANGE_RATE"
  | "STALE_EXCHANGE_RATE"
  /** Round 5 Spec 1B — a duplicate customer warning needs an answer (`details.duplicate`). */
  | "DUPLICATE_ACKNOWLEDGEMENT_REQUIRED";

export interface ErrorFieldDetail {
  field: string;
  constraints: string[];
}

interface StructuredErrorBody {
  code?: ErrorCode;
  message?: string;
  fields?: ErrorFieldDetail[];
  details?: Record<string, unknown>;
}

/**
 * `apiClient` is a plain module, not a React component, so it can't call
 * `useLocale()` — reads the same localStorage key that `LocaleProvider`
 * persists to instead. Safe to read outside React: it's synchronous,
 * read-only, and only ever affects which language an error message renders
 * in, never app state.
 */
export function currentLocale(): Locale {
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
/**
 * A 403 whose message is only the framework default ("Forbidden",
 * "Forbidden resource") or the PermissionsGuard's technical
 * `Missing permission "x.y".` / `No permission is registered …` carries no
 * explanation worth showing — those keep the generic localized text. Any
 * other 403 message was deliberately authored by a business rule (e.g. "a
 * declaration correction after fulfillment needs store-orders.manage or
 * sales.receipts.confirm") and is shown as-is, so the user learns WHY.
 */
export function isGenericForbiddenMessage(rawMessage: string | undefined | null): boolean {
  const text = rawMessage?.trim();
  if (!text) return true;
  return (
    /^forbidden( resource)?\.?$/i.test(text) ||
    /^missing permission "[^"]+"\.?$/i.test(text) ||
    /^no permission is registered for /i.test(text)
  );
}

const ARABIC_LETTERS = /[؀-ۿ]/;

/**
 * Whether a raw server message is already written in the UI language's
 * script, so it can be shown verbatim: Arabic text for `ar`; for `en`, text
 * with no Arabic letters that is not the generic unique-constraint fallback
 * ("A record with this … already exists.").
 */
export function isInUiLanguage(rawMessage: string | undefined | null, locale: Locale): boolean {
  const text = rawMessage?.trim();
  if (!text) return false;
  if (locale === "ar") return ARABIC_LETTERS.test(text);
  return !ARABIC_LETTERS.test(text) && !/^A record with this /.test(text);
}

function friendlyMessage(
  code: ErrorCode,
  rawMessage: string | undefined,
  fields: ErrorFieldDetail[] | undefined,
  locale: Locale,
  status?: number,
): string {
  const dict = messages[locale];
  if (code === "VALIDATION_ERROR" && fields === undefined && rawMessage) {
    return rawMessage;
  }
  if (
    status === 403 &&
    code === "PERMISSION_ERROR" &&
    rawMessage &&
    !isGenericForbiddenMessage(rawMessage)
  ) {
    return rawMessage;
  }
  if ((code === "MISSING_EXCHANGE_RATE" || code === "STALE_EXCHANGE_RATE") && rawMessage) {
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
  // A service-thrown conflict can carry specific guidance (e.g. "exists but
  // is archived — restore it instead"), but only show it when it is written
  // in the UI language — an English sentence never leaks into the Arabic UI;
  // everything else gets the localized field template / generic key.
  const duplicateRaw =
    code === "DUPLICATE" && isInUiLanguage(rawMessage, locale) ? rawMessage : undefined;
  if (duplicateRaw) {
    return duplicateRaw;
  }
  if (code === "DUPLICATE" && primaryField === "email") {
    return translate(dict, "errors.DUPLICATE_EMAIL");
  }
  if (label && (code === "VALIDATION_ERROR" || code === "DUPLICATE")) {
    return translate(dict, `errors.${code}_FIELD` as MessageKey, { field: label });
  }
  const key = `errors.${code}` as MessageKey;
  const translated = translate(dict, key);
  if (translated !== key) return translated;
  // No UI text for this code (e.g. the Agents module's business codes): the
  // server's own «عربي — English» message is the clear explanation — show
  // the half in the UI language, never the raw key.
  const serverText = uiLanguagePart(rawMessage, locale);
  if (serverText) return serverText;
  return translate(dict, `errors.${codeForStatus(status ?? 500)}` as MessageKey);
}

/**
 * Picks the UI-language half of a bilingual «عربي — English» server message
 * (or the whole message when it is already in the UI language). Returns
 * undefined when neither applies.
 */
export function uiLanguagePart(rawMessage: string | undefined | null, locale: Locale) {
  const text = rawMessage?.trim();
  if (!text) return undefined;
  const separator = " — ";
  let index = text.indexOf(separator);
  while (index > 0) {
    const arabic = text.slice(0, index).trim();
    const english = text.slice(index + separator.length).trim();
    if (ARABIC_LETTERS.test(arabic) && english && !ARABIC_LETTERS.test(english)) {
      return locale === "ar" ? arabic : english;
    }
    index = text.indexOf(separator, index + separator.length);
  }
  return isInUiLanguage(text, locale) ? text : undefined;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: ErrorCode = "SERVER_ERROR",
    public readonly fields?: ErrorFieldDetail[],
    /** Machine-readable context for recoverable codes (see MISSING_EXCHANGE_RATE). */
    public readonly details?: Record<string, unknown>,
    /** The whole error body — business codes (e.g. PRODUCT_BARCODE_DUPLICATE) carry their own extra fields (`sku`, `reason`…). */
    public readonly body?: Record<string, unknown>,
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

  if (response.status === 401 && typeof window !== "undefined" && !isSigningOut()) {
    clearAuthToken();
    if (!window.location.pathname.startsWith("/login")) {
      // R6 (spec A.4) — come back to the same page (incl. its query) after
      // signing in again; the login page validates `next` before using it.
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = `/login?next=${encodeURIComponent(next)}`;
    }
  }

  if (!response.ok) {
    const body: StructuredErrorBody | undefined = await response.json().catch(() => undefined);
    // S7 — a temporary password must be replaced before anything else works:
    // any API refusal for that reason sends the user to the own-password page.
    if (
      response.status === 403 &&
      (body?.code as string | undefined) === "MUST_CHANGE_PASSWORD" &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/profile/password"
    ) {
      window.location.href = "/profile/password";
    }
    const code = body?.code ?? codeForStatus(response.status);
    // The technical detail (constraint names, the original English message)
    // stays in the console for developers — never in the toast the user sees.
    // A 404 is often an expected state (e.g. "no employee linked to me"),
    // not a fault — keep it visible for developers without flagging it red.
    const log = response.status === 404 ? console.warn : console.error;
    log(`[api-client] ${response.status} ${code} on ${path}:`, body?.message, body?.fields);
    const message = friendlyMessage(code, body?.message, body?.fields, locale, response.status);
    throw new ApiError(
      response.status,
      message,
      code,
      body?.fields,
      body?.details,
      body as Record<string, unknown> | undefined,
    );
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
  /** `headers` — per-request extras (e.g. an `Idempotency-Key` that makes a retried create safe). */
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
      ...(headers ? { headers } : {}),
    }),
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
