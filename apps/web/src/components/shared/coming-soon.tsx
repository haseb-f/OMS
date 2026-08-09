"use client";

import { Construction } from "lucide-react";
import { EmptyState } from "./empty-state";
import { useLocale } from "@/providers/locale-provider";

/** Placeholder for a navigation route that exists in navigation.config.ts but has no page built yet. */
export function ComingSoon() {
  const { t } = useLocale();

  return (
    <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/40">
      <EmptyState
        icon={Construction}
        title={t("common.comingSoon")}
        description={t("common.comingSoonDescription")}
      />
    </div>
  );
}
