"use client";

import { StatusBadge } from "@/components/business/status-badge";
import {
  FOLLOW_UP_OUTCOME_TONE,
  followUpOutcomeLabel,
  isLeadFollowUpOutcome,
} from "@/config/crm/follow-up-outcomes";
import { useLocale } from "@/providers/locale-provider";

/**
 * R6 (spec C1) — a lead's follow-up classification (its latest outcome) as
 * a badge. Shared by the internal lead list/detail and the agent lead
 * screens (read-only). A legacy free-text outcome renders neutral, as typed.
 */
export function FollowUpOutcomeBadge({ value }: { value: string | null | undefined }) {
  const { t } = useLocale();
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <StatusBadge
      label={followUpOutcomeLabel(value, t)}
      tone={isLeadFollowUpOutcome(value) ? FOLLOW_UP_OUTCOME_TONE[value] : "neutral"}
    />
  );
}
