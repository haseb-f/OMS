"use client";

import { Loader2 } from "lucide-react";
import { useLocale } from "@/providers/locale-provider";

/**
 * Full-content loading state for a gated page while auth/permission
 * initialization is still in flight (see `PermissionGate`) — same
 * container sizing as `AccessDenied` so there's no layout jump between the
 * two, never a bespoke per-page spinner.
 */
export function PageLoading() {
  const { t } = useLocale();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
    </div>
  );
}
