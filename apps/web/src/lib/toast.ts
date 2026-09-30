/**
 * Canonical toast import path for OMS — every module imports `toast` from
 * here instead of `sonner` directly, so the global feedback standard lives in
 * exactly one place rather than being repeated (or drifting) per call site.
 *
 * Semantics per tone (usability-financial-reports §5; `toastSemantics`):
 *   success     — green tinted card, polite (`role="status"`), 5s.
 *   info        — quiet card, polite, 5s.
 *   warning     — quiet card, polite, 7s.
 *   error       — red tinted card, assertive (`role="alert"`), 10s, close
 *                 button; persistent (never auto-dismissed) when it carries a
 *                 Retry action or is marked critical.
 *   destructive — a CONFIRMED destructive operation (order cancelled,
 *                 document voided): red tinted card, polite (it is not a
 *                 failure), 6s. Use `reportDestructiveDone`.
 * A caller's own `duration` always wins. `toast.loading`, `toast.promise`,
 * `toast.custom`, `toast.message` and bare `toast(...)` are untouched — the
 * long-running/manual cases that stay until resolved or dismissed.
 * Manual close and hover/focus-pause are sonner defaults.
 *
 * Harmless dismissal (closing an unchanged form, Esc on a dialog) never
 * toasts; only a server-confirmed outcome does — call these helpers after the
 * request resolved, never optimistically.
 */
import { createElement, type ReactNode } from "react";
import { Ban } from "lucide-react";
import { toast as sonnerToast, type ExternalToast } from "sonner";
import { ApiError, currentLocale } from "@/services/api-client";
import { messages } from "@/i18n/messages";
import { translate, type MessageKey } from "@/i18n/translate";
import type { Locale } from "@/i18n/locales";

export type ToastTone = "success" | "info" | "warning" | "error" | "destructive";

/** Default auto-dismiss per tone (ms). */
export const TOAST_DURATIONS: Record<ToastTone, number> = {
  success: 5000,
  info: 5000,
  warning: 7000,
  error: 10000,
  destructive: 6000,
};

/** Never auto-dismissed (sonner treats Infinity as persistent). */
export const TOAST_PERSISTENT = Number.POSITIVE_INFINITY;

export interface ToastSemantics {
  role: "status" | "alert";
  ariaLive: "polite" | "assertive";
  duration: number;
  closeButton: boolean;
}

/**
 * Pure mapping tone → announcement + lifetime (unit-tested). Errors are
 * assertive; every toast carries a visible, labelled × close button;
 * `persistent` (critical / actionable) removes the auto-dismiss.
 */
export function toastSemantics(tone: ToastTone, persistent = false): ToastSemantics {
  const isError = tone === "error";
  return {
    role: isError ? "alert" : "status",
    ariaLive: isError ? "assertive" : "polite",
    duration: persistent ? TOAST_PERSISTENT : TOAST_DURATIONS[tone],
    closeButton: true,
  };
}

type ToastMessage = ReactNode | (() => ReactNode);

/**
 * Sonner's region is one polite live region. The title is wrapped in its own
 * live region so the nearest-ancestor politeness applies: errors interrupt
 * (`role="alert"`), everything else waits (`role="status"`).
 */
function announced(tone: ToastTone, message: ToastMessage): ToastMessage {
  const { role, ariaLive } = toastSemantics(tone);
  const wrap = (node: ReactNode) =>
    createElement(
      "span",
      { role, "aria-live": ariaLive, "aria-atomic": "true", "data-toast-tone": tone },
      node,
    );
  return typeof message === "function" ? () => wrap(message()) : wrap(message);
}

// Captured before any mutation below — these are sonner's real
// success/info/warning/error functions, never the wrapped ones. Reading
// `sonnerToast[variant]` again *after* patching it would call the wrapper
// itself and recurse infinitely.
const originals = {
  base: sonnerToast.message.bind(sonnerToast),
  success: sonnerToast.success.bind(sonnerToast),
  info: sonnerToast.info.bind(sonnerToast),
  warning: sonnerToast.warning.bind(sonnerToast),
  error: sonnerToast.error.bind(sonnerToast),
};

type Variant = "success" | "info" | "warning" | "error";

function withDefaults(variant: Variant, message: ToastMessage, options?: ExternalToast) {
  const semantics = toastSemantics(variant);
  return originals[variant](announced(variant, message), {
    duration: semantics.duration,
    closeButton: semantics.closeButton,
    ...options,
  });
}

export const toast: typeof sonnerToast = Object.assign(sonnerToast, {
  success: (message: ToastMessage, options?: ExternalToast) =>
    withDefaults("success", message, options),
  info: (message: ToastMessage, options?: ExternalToast) => withDefaults("info", message, options),
  warning: (message: ToastMessage, options?: ExternalToast) =>
    withDefaults("warning", message, options),
  error: (message: ToastMessage, options?: ExternalToast) =>
    withDefaults("error", message, options),
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

function localized(key: MessageKey): string {
  return translate(messages[currentLocale()], key);
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

export interface ReportErrorOptions extends ExternalToast {
  /** Adds a «إعادة المحاولة / Retry» action and keeps the toast until handled. */
  onRetry?: () => void;
  /** A critical failure the user must see: never auto-dismissed. */
  critical?: boolean;
}

/** Sonner options for an error toast — pure, unit-tested. */
export function errorToastOptions(options: ReportErrorOptions = {}): ExternalToast {
  const { onRetry, critical, ...rest } = options;
  const persistent = Boolean(onRetry || critical);
  return {
    ...(persistent ? { duration: toastSemantics("error", true).duration } : {}),
    ...(onRetry ? { action: { label: localized("toast.retry"), onClick: () => onRetry() } } : {}),
    ...rest,
  };
}

/**
 * Canonical "surface an API failure" helper — the single path every module
 * uses instead of `toast.error(error instanceof ApiError ? error.message : "…")`.
 * Pass an i18n key as the fallback (`reportApiError(error, "errors.loadFailed")`);
 * an already-translated `t(...)` string also works. Callers keep their own
 * try/catch; this only standardizes the line that turns `error` into a toast.
 * `onRetry` / `critical` make it persistent (and actionable).
 */
export function reportApiError(
  error: unknown,
  fallback: ApiErrorFallback = "errors.generic",
  options?: ReportErrorOptions,
) {
  return toast.error(apiErrorMessage(error, fallback), errorToastOptions(options));
}

/**
 * Canonical "it worked" feedback — a toast that can carry a link to the
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
          label: linkLabel ?? localized("feedback.success.openRecord"),
          onClick: () => (navigate ? navigate(href) : window.location.assign(href)),
        }
      : undefined,
  });
}

/** Sonner options for a confirmed destructive outcome — pure, unit-tested. */
export function destructiveDoneOptions(
  options: { description?: string; duration?: number } = {},
): ExternalToast {
  const semantics = toastSemantics("destructive");
  return {
    description: options.description,
    duration: options.duration ?? semantics.duration,
    className: "oms-toast-destructive",
    icon: createElement(Ban, { className: "size-5", "aria-hidden": true }),
  };
}

/**
 * A destructive operation the user CONFIRMED and the server COMPLETED
 * (cancel an order, void a document, delete a record): the red treatment so
 * the consequence is unmistakable, announced politely because nothing failed.
 * Never for dismissing a dialog or closing an unchanged form — those show
 * nothing.
 */
export function reportDestructiveDone(
  message: string,
  options: { description?: string; duration?: number } = {},
) {
  return originals.base(announced("destructive", message), destructiveDoneOptions(options));
}
