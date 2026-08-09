"use client";

import { ShieldAlert } from "lucide-react";
import { EmptyState } from "./empty-state";
import { useLocale } from "@/providers/locale-provider";

/** Shown in place of a page's content once permission checks exist — no permission system is wired up yet (see TODO.md). */
export function NoPermission() {
  const { t } = useLocale();

  return (
    <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/40">
      <EmptyState
        icon={ShieldAlert}
        title={t("common.noPermission")}
        description={t("common.noPermissionDescription")}
      />
    </div>
  );
}
