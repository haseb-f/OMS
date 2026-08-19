"use client";

import type { ReactNode } from "react";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/date";
import { useLocale } from "@/providers/locale-provider";
import type { MessageKey } from "@/i18n/translate";

/** Shared geometry for every Import Center synchronization button. */
export const SYNC_ACTION_BUTTON_CLASS =
  "h-(--control-height-md) w-full min-w-0 max-w-full shrink-0 justify-center gap-2 overflow-hidden rounded-md px-3 text-[length:var(--text-button)] whitespace-nowrap";

export function formatSyncLastSyncValue(
  lastSyncedAt: string | null | undefined,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  if (!lastSyncedAt) return t("importCenter.sync.statusNeverRunShort");
  const then = new Date(lastSyncedAt).getTime();
  if (Number.isNaN(then)) return t("importCenter.sync.statusNeverRunShort");
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
        "h-full min-w-0 [--card-spacing:--spacing(3)]",
        isReference && "border-warning/35 bg-warning-soft/40",
      )}
    >
      <EnterpriseCardContent className="flex h-full min-h-0 flex-1 flex-col gap-2">
        <h3 className="line-clamp-2 text-body font-semibold leading-snug text-start">{title}</h3>
        <p className="line-clamp-2 text-caption leading-snug text-muted-foreground text-start">
          {description}
        </p>
        <div className="mt-auto flex w-full min-w-0 flex-col gap-2 [&_[data-slot=button]]:h-(--control-height-md) [&_[data-slot=button]]:w-full [&_[data-slot=button]]:min-w-0 [&_[data-slot=button]]:max-w-full">
          {children}
        </div>
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
