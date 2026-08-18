"use client";

import type { ReactNode } from "react";
import { EnterpriseCard, EnterpriseCardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Shared Data Synchronization workspace card. Both inbound (Google → OMS)
 * and reference-sync (OMS → Google) use this anatomy so the five Import
 * Center actions stay one visual family.
 */
export function SyncWorkspaceCard({
  variant = "inbound",
  title,
  description,
  direction,
  lastSyncLabel,
  children,
}: {
  variant?: "inbound" | "reference-sync";
  title: string;
  description: string;
  direction?: string;
  lastSyncLabel?: string | null;
  children: ReactNode;
}) {
  const isReference = variant === "reference-sync";

  return (
    <EnterpriseCard
      size="sm"
      className={cn(
        "[--card-spacing:--spacing(3)] min-w-0 shadow-sm",
        isReference && "bg-linear-to-b from-warning-soft/55 to-card ring-warning/25",
      )}
    >
      <EnterpriseCardContent className="flex h-full flex-col gap-2">
        <div className="flex min-h-0 flex-1 flex-col gap-0.5">
          <h3 className="text-body font-semibold leading-snug text-start">{title}</h3>
          {direction ? (
            <p className="text-caption font-medium text-warning-foreground/80" dir="ltr">
              {direction}
            </p>
          ) : null}
          <p className="text-caption leading-snug text-muted-foreground text-start">
            {description}
          </p>
        </div>
        {children}
        {lastSyncLabel ? (
          <p className="text-caption text-muted-foreground text-start">{lastSyncLabel}</p>
        ) : null}
      </EnterpriseCardContent>
    </EnterpriseCard>
  );
}
