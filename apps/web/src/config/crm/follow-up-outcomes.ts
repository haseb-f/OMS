import type { StatusTone } from "@/components/business/status-tone";
import type { MessageKey } from "@/i18n/translate";

/**
 * R6 (spec C1) — mirror of the API's server-owned outcome list
 * (`apps/api/src/leads/follow-up-outcomes.ts`). The API validates every
 * follow-up against it; `follow-up-outcomes.spec.ts` fails if the two drift.
 * A follow-up's outcome is the lead's follow-up classification
 * (`Lead.followUpOutcome`). Labels: `crm.leads.followUp.outcomes.*`.
 */
export const LEAD_FOLLOW_UP_OUTCOMES = [
  "answered",
  "noAnswer",
  "interested",
  "callback",
  "wrongNumber",
  "notInterested",
] as const;

export type LeadFollowUpOutcome = (typeof LEAD_FOLLOW_UP_OUTCOMES)[number];

export function isLeadFollowUpOutcome(value: unknown): value is LeadFollowUpOutcome {
  return (
    typeof value === "string" && (LEAD_FOLLOW_UP_OUTCOMES as readonly string[]).includes(value)
  );
}

/** Badge tone per outcome — tokens via `StatusBadge`, never a raw color. */
export const FOLLOW_UP_OUTCOME_TONE: Record<LeadFollowUpOutcome, StatusTone> = {
  answered: "info",
  interested: "success",
  callback: "warning",
  noAnswer: "neutral",
  wrongNumber: "destructive",
  notInterested: "destructive",
};

export function followUpOutcomeLabelKey(outcome: LeadFollowUpOutcome): MessageKey {
  return `crm.leads.followUp.outcomes.${outcome}`;
}

/**
 * Label for any stored value: a known code is translated; a legacy
 * free-text outcome (recorded before the list was closed) shows as typed.
 */
export function followUpOutcomeLabel(
  value: string | null | undefined,
  t: (key: MessageKey) => string,
): string {
  if (!value) return "";
  return isLeadFollowUpOutcome(value) ? t(followUpOutcomeLabelKey(value)) : value;
}
