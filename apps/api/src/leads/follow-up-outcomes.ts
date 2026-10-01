/**
 * R6 (spec C1) — the closed, server-owned list of follow-up outcomes
 * («نتيجة التواصل»). A follow-up's outcome IS the lead's follow-up
 * classification: `Lead.followUpOutcome` holds the latest one.
 *
 * Codes only — labels live in the web i18n (`crm.leads.followUp.outcomes.*`).
 * The web mirror `apps/web/src/config/crm/follow-up-outcomes.ts` is checked
 * against this file by `follow-up-outcomes.spec.ts` there; the backfill in
 * migration 20261001143000_r6_lead_follow_up_outcome lists the same codes.
 */
export const LEAD_FOLLOW_UP_OUTCOMES = [
  'answered',
  'noAnswer',
  'interested',
  'callback',
  'wrongNumber',
  'notInterested',
] as const;

export type LeadFollowUpOutcome = (typeof LEAD_FOLLOW_UP_OUTCOMES)[number];

export function isLeadFollowUpOutcome(
  value: unknown,
): value is LeadFollowUpOutcome {
  return (
    typeof value === 'string' &&
    (LEAD_FOLLOW_UP_OUTCOMES as readonly string[]).includes(value)
  );
}

/**
 * The time a follow-up's outcome counts from: when it was completed, else
 * when it was recorded. `followUpAt` is the next scheduled contact and never
 * orders outcomes. Same rule as the migration backfill.
 */
export function followUpOutcomeRecordedAt(followUp: {
  completedAt: Date | null;
  createdAt: Date;
}): Date {
  return followUp.completedAt ?? followUp.createdAt;
}
