/**
 * Canonical toast import path for OMS — every module imports `toast` from
 * here instead of `sonner` directly, so the global feedback duration
 * standard lives in exactly one place rather than being repeated (or
 * drifting) per call site.
 *
 * Defaults (ms), applied only when a caller doesn't pass its own
 * `duration`:
 *   success / info = 5000, warning = 7000, error = 8000.
 * `toast.loading`, `toast.promise`, `toast.custom`, `toast.message`, and
 * bare `toast(...)` are untouched — those are the long-running/manual
 * cases (import progress, etc.) that intentionally stay until the
 * operation resolves or the caller dismisses them. Manual close and
 * hover/focus-pause are sonner defaults and are not affected by this.
 */
import { toast as sonnerToast, type ExternalToast } from "sonner";
import { ApiError, currentLocale } from "@/services/api-client";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import type { Locale } from "@/i18n/locales";

const DEFAULT_DURATIONS = {
  success: 5000,
  info: 5000,
  warning: 7000,
  error: 8000,
} as const;

// Captured before any mutation below — these are sonner's real
// success/info/warning/error functions, never the wrapped ones. Reading
// `sonnerToast[variant]` again *after* patching it would call the wrapper
// itself and recurse infinitely.
const originals = {
  success: sonnerToast.success.bind(sonnerToast),
  info: sonnerToast.info.bind(sonnerToast),
  warning: sonnerToast.warning.bind(sonnerToast),
  error: sonnerToast.error.bind(sonnerToast),
};

function withDefaultDuration(
  variant: keyof typeof DEFAULT_DURATIONS,
  message: React.ReactNode | (() => React.ReactNode),
  options?: ExternalToast,
) {
  return originals[variant](message, {
    duration: DEFAULT_DURATIONS[variant],
    ...options,
  });
}

export const toast: typeof sonnerToast = Object.assign(sonnerToast, {
  success: (message: React.ReactNode | (() => React.ReactNode), options?: ExternalToast) =>
    withDefaultDuration("success", message, options),
  info: (message: React.ReactNode | (() => React.ReactNode), options?: ExternalToast) =>
    withDefaultDuration("info", message, options),
  warning: (message: React.ReactNode | (() => React.ReactNode), options?: ExternalToast) =>
    withDefaultDuration("warning", message, options),
  error: (message: React.ReactNode | (() => React.ReactNode), options?: ExternalToast) =>
    withDefaultDuration("error", message, options),
});

/** A caller-supplied fallback: an i18n key (preferred) or already-translated text from `t(...)`. */
export type ApiErrorFallback = MessageKey | (string & {});

function isMessageKey(value: string): value is MessageKey {
  // A key resolves to a different string in the dictionary; plain text resolves to itself.
  return (
    /^[A-Za-z][\w-]*(\.[\w-]+)+$/.test(value) &&
    translate(messages.en, value as MessageKey) !== value
  );
}

/**
 * The text `reportApiError` shows — exported for inline error panels and tests.
 * An `ApiError` already carries the localized, user-facing message built by
 * `api-client` (including the server's own authored business message when it
 * sent one), so that wins. Anything else — a network/JS error, an empty
 * message — shows the fallback in the active UI language; a raw JS error
 * message is never shown to the user.
 */
export function apiErrorMessage(
  error: unknown,
  fallback: ApiErrorFallback = "errors.generic",
  locale: Locale = currentLocale(),
): string {
  if (error instanceof ApiError && error.message.trim()) return error.message;
  return isMessageKey(fallback) ? translate(messages[locale], fallback) : fallback;
}

/**
 * Canonical "surface an API failure" helper — the single path every module
 * uses instead of `toast.error(error instanceof ApiError ? error.message : "…")`.
 * Pass an i18n key as the fallback (`reportApiError(error, "errors.loadFailed")`);
 * an already-translated `t(...)` string also works. Callers keep their own
 * try/catch; this only standardizes the line that turns `error` into a toast.
 */
export function reportApiError(
  error: unknown,
  fallback: ApiErrorFallback = "errors.generic",
  options?: ExternalToast,
) {
  return toast.error(apiErrorMessage(error, fallback), options);
}

/**
 * Canonical "it worked" feedback — a top toast that can carry a link to the
 * resulting record (e.g. the order an action created).
 *
 * The toast only SUPPLEMENTS on-page confirmation (design-system §11.4): the
 * caller must also update the document header/status (or the list row) in
 * place from the server response, so the success is visible after the toast
 * is gone. Call this only after the request has resolved — never optimistically.
 *
 * `navigate` should be the router's `push` so the link is a client-side
 * navigation; it falls back to a full page load.
 */
export function reportSuccess(
  message: string,
  options: {
    description?: string;
    href?: string;
    /** Defaults to "Open record". */
    linkLabel?: string;
    navigate?: (href: string) => void;
    duration?: number;
  } = {},
) {
  const { description, href, linkLabel, navigate, duration } = options;
  // A toast with a link stays longer, so the user has time to use it. An
  // explicit `undefined` would override the default duration, so omit it.
  const effectiveDuration = duration ?? (href ? 8000 : undefined);
  return toast.success(message, {
    description,
    ...(effectiveDuration !== undefined ? { duration: effectiveDuration } : {}),
    action: href
      ? {
          label: linkLabel ?? translate(messages[currentLocale()], "feedback.success.openRecord"),
          onClick: () => (navigate ? navigate(href) : window.location.assign(href)),
        }
      : undefined,
  });
}
