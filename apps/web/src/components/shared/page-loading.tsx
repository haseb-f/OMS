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
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center"
    >
      <Loader2
        className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
        aria-hidden
      />
      <p className="text-caption text-muted-foreground">{t("common.loading")}</p>
    </div>
  );
}
