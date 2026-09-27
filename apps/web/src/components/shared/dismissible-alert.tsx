"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, XIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EnterpriseButton } from "@/components/ui/button";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

type Tone = "destructive" | "warning" | "success" | "info" | "neutral";

const ICONS: Record<Tone, typeof Info> = {
  destructive: CircleAlert,
  warning: TriangleAlert,
  success: CircleCheck,
  info: Info,
  neutral: Info,
};

const noopSubscribe = () => () => {};

const STORAGE_PREFIX = "oms.dismissed-alert.";

function readDismissed(key: string | undefined) {
  if (!key || typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(STORAGE_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

/**
 * A persistent warning/notice (design-system §11.4) — stays on the page until
 * the condition is resolved (the caller stops rendering it) or the user
 * dismisses it. It never times out like a toast.
 *
 * `dismissKey` remembers the dismissal for this browser session, so a warning
 * the user already acknowledged doesn't reappear on every navigation. Change
 * the key (e.g. include the record id or the count) when the underlying
 * condition changes and the warning should show again. Omit `dismissible`
 * for a warning that must stay until resolved.
 */
export function DismissibleAlert({
  tone = "warning",
  title,
  children,
  action,
  dismissible = true,
  dismissKey,
  onDismiss,
  live = false,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  /** An action slot at the end (e.g. "Retry", "Open settings"). */
  action?: ReactNode;
  dismissible?: boolean;
  dismissKey?: string;
  onDismiss?: () => void;
  /** Announce politely when it appears (use for results of a user action, not for standing page state). */
  live?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // Server snapshot is "not dismissed" so hydration matches; the stored
  // dismissal applies right after hydration.
  const storedDismissed = useSyncExternalStore(
    noopSubscribe,
    () => readDismissed(dismissKey),
    () => false,
  );
  const dismissed = dismissedKey === (dismissKey ?? "") || storedDismissed;

  if (dismissed) return null;

  const Icon = ICONS[tone];

  const dismiss = () => {
    if (dismissKey) {
      try {
        window.sessionStorage.setItem(STORAGE_PREFIX + dismissKey, "1");
      } catch {
        // Storage unavailable — dismissal still applies for this render tree.
      }
    }
    setDismissedKey(dismissKey ?? "");
    onDismiss?.();
  };

  return (
    <Alert
      tone={tone}
      role={tone === "destructive" && live ? "alert" : live ? "status" : undefined}
      className={cn("items-start", className)}
    >
      <Icon aria-hidden="true" />
      <AlertDescription className="flex flex-col gap-0.5">
        {title ? <AlertTitle>{title}</AlertTitle> : null}
        {children}
      </AlertDescription>
      {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
      {dismissible ? (
        <EnterpriseButton
          type="button"
          variant="ghost"
          size="icon-xs"
          className="-me-1 -mt-0.5 shrink-0 text-current hover:bg-transparent hover:opacity-80"
          onClick={dismiss}
          aria-label={t("feedback.alert.dismiss")}
        >
          <XIcon />
        </EnterpriseButton>
      ) : null}
    </Alert>
  );
}
