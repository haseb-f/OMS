"use client";

import { Fragment, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { EnterpriseButton } from "@/components/ui/button";
import { STATUS_TONE_DOT_CLASS, type StatusTone } from "@/components/business/status-tone";
import {
  describeLeadDistribution,
  type LeadDistributionState,
} from "@/components/crm/lead-distribution-control";
import { useLocale } from "@/providers/locale-provider";
import { cn } from "@/lib/utils";

const VARIANT_TONE: Record<string, StatusTone> = {
  success: "success",
  info: "info",
  secondary: "neutral",
  warning: "warning",
};

/**
 * Round 3 pilot: the lead-distribution state as ONE quiet meta line in the
 * page header (status dot + state, then plain counters) instead of a strip of
 * chips. Same data and the same «open modes» action as `LeadDistributionStatus`.
 */
export function LeadDistributionMetaPilot({
  state,
  onOpenModes,
}: {
  state: LeadDistributionState;
  onOpenModes: () => void;
}) {
  const { t } = useLocale();
  if (!state.canManage) return null;
  const d = describeLeadDistribution(state, t);
  const tone = d.running ? "success" : (VARIANT_TONE[d.badge.variant] ?? "neutral");

  const parts: ReactNode[] = [];
  if (d.pendingCount > 0) {
    parts.push(t("crm.leads.distribution.pendingCount", { count: d.pendingCount }));
  }
  if (d.heldCount > 0) {
    parts.push(t("crm.leads.distribution.heldCount", { count: d.heldCount }));
  }
  if (d.failureReason) {
    parts.push(
      <span
        className="inline-flex items-center gap-1 font-medium text-destructive-soft-foreground"
        title={d.failureReason}
      >
        <TriangleAlert aria-hidden className="size-3.5" />
        {t("crm.leads.distribution.failureReason")}
      </span>,
    );
  }

  return (
    <div
      role="group"
      aria-label={t("crm.leads.distribution.title")}
      title={d.lastRun}
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground"
    >
      <EnterpriseButton
        type="button"
        variant="ghost"
        size="inline"
        onClick={onOpenModes}
        className="text-caption font-medium text-foreground hover:bg-transparent hover:underline"
      >
        <span aria-hidden className={cn("size-2 rounded-full", STATUS_TONE_DOT_CLASS[tone])} />
        {t("crm.leads.distribution.title")}:{" "}
        {d.running ? t("crm.leads.distribution.running") : d.badge.label}
        {d.status === "TIME_LIMITED" && d.remainingHours != null ? (
          <span dir="ltr" className="num">
            · {d.remainingHours}h
          </span>
        ) : null}
      </EnterpriseButton>
      {parts.map((part, index) => (
        <Fragment key={index}>
          <span aria-hidden>·</span>
          <span>{part}</span>
        </Fragment>
      ))}
    </div>
  );
}
