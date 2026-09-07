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
