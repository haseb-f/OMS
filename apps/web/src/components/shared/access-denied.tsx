"use client";

import { ShieldAlert } from "lucide-react";
import { useLocale } from "@/providers/locale-provider";

/**
 * TASK-060 Part 6 — "Every page checks View permission. Otherwise: 403
 * Access Denied." One shared full-page state, reused by every
 * `PermissionGate`; never a bespoke per-page "you can't be here" message.
 */
export function AccessDenied() {
  const { t } = useLocale();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <div className="flex size-10 items-center justify-center rounded-md bg-destructive/10 text-destructive">
        <ShieldAlert className="size-5" strokeWidth={1.75} />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-body font-semibold">{t("accessDenied.title")}</p>
        <p className="text-caption text-muted-foreground">{t("accessDenied.description")}</p>
      </div>
    </div>
  );
}
