"use client";

import { WifiOff } from "lucide-react";
import { EmptyState } from "./empty-state";
import { useLocale } from "@/providers/locale-provider";

/** Shown when a data-fetching component detects the browser is offline. */
export function OfflinePlaceholder() {
  const { t } = useLocale();

  return (
    <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/40">
      <EmptyState
        icon={WifiOff}
        title={t("common.offline")}
        description={t("common.offlineDescription")}
      />
    </div>
  );
}
