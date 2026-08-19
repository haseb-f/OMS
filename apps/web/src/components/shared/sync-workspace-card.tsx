"use client";

import type { ReactNode } from "react";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

/** Shared geometry for every Import Center synchronization button. */
export const SYNC_ACTION_BUTTON_CLASS =
  "h-(--control-height-md) w-full justify-center gap-2 rounded-md px-3 text-[length:var(--text-button)]";

export function formatSyncLastSyncValue(
  lastSyncedAt: string | null | undefined,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  if (!lastSyncedAt) return t("importCenter.sync.statusNeverRunShort");
  const then = new Date(lastSyncedAt).getTime();
  if (Number.isNaN(then)) return t("importCenter.sync.statusNeverRunShort");
  const minutes = Math.max(1, Math.round((Date.now() - then) / 60_000));
  if (minutes < 60) return t("importCenter.sync.lastSyncMinutesAgo", { minutes });
  return formatDateTime(lastSyncedAt);
}

export function SyncLastSyncLabel({ lastSyncedAt }: { lastSyncedAt: string | null | undefined }) {
  const { t } = useLocale();
  return (
    <p className="text-caption text-muted-foreground text-start">
      {t("importCenter.sync.lastSyncLine", {
        value: formatSyncLastSyncValue(lastSyncedAt, t),
      })}
    </p>
  );
}

/**
 * Shared Data Synchronization workspace card. Both inbound (Google → OMS)
 * and reference-sync (OMS → Google) use this anatomy so the five Import
 * Center actions stay one visual family: title, description, button, last sync.
 */
export function SyncWorkspaceCard({
  variant = "inbound",
  title,
  description,
  children,
}: {
  variant?: "inbound" | "reference-sync";
  title: string;
  description: string;
  children: ReactNode;
}) {
  const isReference = variant === "reference-sync";

  return (
    <EnterpriseCard
      size="sm"
      className={cn(
        "[--card-spacing:--spacing(3)] min-w-0 shadow-sm",
        isReference && "border-warning/30 bg-warning-soft/40 ring-warning/20",
      )}
    >
      <EnterpriseCardContent className="flex flex-col gap-2">
        <h3 className="text-body font-semibold leading-snug text-start">{title}</h3>
        <p className="text-caption leading-snug text-muted-foreground text-start">{description}</p>
        {children}
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
