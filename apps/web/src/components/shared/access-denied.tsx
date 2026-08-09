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
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <div className="relative flex size-20 items-center justify-center rounded-full bg-destructive/10 ring-8 ring-destructive/5">
        <ShieldAlert className="size-8 text-destructive" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-page-title font-semibold">{t("accessDenied.title")}</p>
        <p className="max-w-sm text-caption text-muted-foreground">
          {t("accessDenied.description")}
        </p>
      </div>
    </div>
  );
}
