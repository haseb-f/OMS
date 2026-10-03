"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusBadge } from "@/components/business/status-badge";
import type { StatusTone } from "@/components/business/status-tone";
import type { LeadDistributionSnapshot, LeadExclusionReason } from "@/services/leads-service";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

/** Reasons the admin can fix in Users / Teams read amber; structural ones stay neutral. */
const REASON_TONE: Record<LeadExclusionReason, StatusTone> = {
  AGENT_USER: "neutral",
  DELETED: "neutral",
  INACTIVE: "warning",
  LOCKED: "warning",
  ON_LEAVE: "warning",
  TERMINATED: "neutral",
  NO_PERMISSION: "warning",
  NOT_SALES_DESIGNATED: "warning",
  WRONG_TEAM: "neutral",
  WRONG_DEPARTMENT: "neutral",
};

/**
 * R7 — who receives leads and who does not, with the reason. Shown (collapsed
 * by default — progressive disclosure) in the distribution dialogs so an empty
 * or short pool is explained, not just counted. Data comes from the server's
 * single shared eligibility rule set; nothing is derived here.
 */
export function LeadDistributionPool({
  snapshot,
  className,
}: {
  snapshot: LeadDistributionSnapshot | null;
  className?: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  if (!snapshot) return null;
  const eligible = snapshot.eligible ?? [];
  const excluded = snapshot.excluded ?? [];

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("rounded-sm border border-border", className)}
      data-testid="lead-distribution-pool"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-start text-caption font-medium text-foreground">
        <span>
          {t("leadOps.distribution.pool.title")}
          <span className="font-normal text-muted-foreground">
            {" · "}
            {t("leadOps.distribution.pool.eligible", { count: eligible.length })}
            {" · "}
            {t("leadOps.distribution.pool.excluded", { count: excluded.length })}
          </span>
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {open ? t("leadOps.distribution.pool.hide") : t("leadOps.distribution.pool.show")}
          <ChevronDown
            aria-hidden
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 border-t border-border px-2.5 py-2.5">
          <p className="text-caption text-muted-foreground">
            {t("leadOps.distribution.pool.rule")}
          </p>
          <section aria-label={t("leadOps.distribution.pool.eligible", { count: eligible.length })}>
            <h4 className="mb-1 text-caption font-medium">
              {t("leadOps.distribution.pool.eligible", { count: eligible.length })}
            </h4>
            {eligible.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                {t("leadOps.distribution.pool.noneEligible")}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5 text-caption">
                {eligible.map((user) => (
                  <li key={user.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-foreground">{user.fullName}</span>
                    <bdi dir="ltr" className="text-muted-foreground">
                      {user.email}
                    </bdi>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label={t("leadOps.distribution.pool.excluded", { count: excluded.length })}>
            <h4 className="mb-1 text-caption font-medium">
              {t("leadOps.distribution.pool.excluded", { count: excluded.length })}
            </h4>
            {excluded.length === 0 ? (
              <p className="text-caption text-muted-foreground">
                {t("leadOps.distribution.pool.noneExcluded")}
              </p>
            ) : (
              <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-caption">
                {excluded.map((user) => (
                  <li key={user.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium text-foreground">{user.fullName}</span>
                    {user.reasons.map((reason) => (
                      <StatusBadge
                        key={reason}
                        tone={REASON_TONE[reason]}
                        label={t(`leadOps.distribution.pool.reasons.${reason}`)}
                      />
                    ))}
                  </li>
                ))}
              </ul>
            )}
            {snapshot.excludedTruncated ? (
              <p className="mt-1 text-caption text-muted-foreground">
                {t("leadOps.distribution.pool.truncated", { count: excluded.length })}
              </p>
            ) : null}
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
