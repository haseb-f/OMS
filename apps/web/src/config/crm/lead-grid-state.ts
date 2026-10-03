import type { StatusTone } from "@/components/business/status-tone";

/**
 * The workflow state a lead card is coloured by (R7 Grid view) and the one
 * next step it shows. Pure functions over the row, shared by the company and
 * the agent lead lists so both read the same way.
 *
 * Deliberately NOT an input: the per-employee "viewed" marker. Having opened a
 * lead says nothing about whether anyone contacted the customer.
 */
export type LeadWorkflowState = "notContacted" | "followingUp" | "converted" | "closed";

export const LEAD_WORKFLOW_STATE_TONE: Record<LeadWorkflowState, StatusTone> = {
  notContacted: "info",
  followingUp: "warning",
  converted: "success",
  closed: "neutral",
};

export interface LeadStateInput {
  status?: { code: string } | null;
  followUpOutcome?: string | null;
  nextFollowUpAt?: string | null;
}

const CLOSED_CODES = new Set(["LOST", "DISQUALIFIED"]);

export function leadWorkflowState(lead: LeadStateInput): LeadWorkflowState {
  const code = lead.status?.code;
  if (code === "CONVERTED") return "converted";
  if (code && CLOSED_CODES.has(code)) return "closed";
  // Still NEW with no recorded outcome and nothing scheduled = nobody has
  // contacted the customer yet; any other open status is being worked.
  if (code === "NEW" && !lead.followUpOutcome && !lead.nextFollowUpAt) return "notContacted";
  return "followingUp";
}

export type LeadNextActionKind =
  | "ASSIGN"
  | "CONVERT"
  | "FOLLOW_UP_OVERDUE"
  | "FOLLOW_UP_SCHEDULED"
  | "FIRST_CONTACT"
  | "SCHEDULE_FOLLOW_UP";

export interface LeadNextAction {
  kind: LeadNextActionKind;
  /** Overdue work is flagged in the destructive tone (with its own text). */
  urgent: boolean;
  /** For FOLLOW_UP_SCHEDULED: when, so the label can say today / tomorrow / the date. */
  scheduledAt?: string;
  day?: "today" | "tomorrow" | "later";
}

export interface LeadNextActionInput extends LeadStateInput {
  /** `null` = in the unassigned pool; `undefined` = not known (agent lists). */
  salesEmployeeId?: string | null;
  storeOrder?: unknown;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Priority: unassigned (for someone who can assign) → convert (when the caller
 * may and nothing was converted) → overdue follow-up → scheduled follow-up →
 * first contact → schedule a follow-up. Closed and converted leads have none.
 */
export function leadNextAction(
  lead: LeadNextActionInput,
  options: { canAssign?: boolean; canConvert?: boolean; now?: Date } = {},
): LeadNextAction | null {
  const state = leadWorkflowState(lead);
  if (state === "converted" || state === "closed") return null;
  const now = options.now ?? new Date();

  if (options.canAssign && lead.salesEmployeeId === null) {
    return { kind: "ASSIGN", urgent: false };
  }
  if (options.canConvert && !lead.storeOrder) return { kind: "CONVERT", urgent: false };

  if (lead.nextFollowUpAt) {
    const when = new Date(lead.nextFollowUpAt);
    if (when.getTime() < now.getTime() && startOfDay(when) < startOfDay(now)) {
      return { kind: "FOLLOW_UP_OVERDUE", urgent: true, scheduledAt: lead.nextFollowUpAt };
    }
    const dayDiff = Math.round((startOfDay(when) - startOfDay(now)) / 86_400_000);
    return {
      kind: "FOLLOW_UP_SCHEDULED",
      urgent: false,
      scheduledAt: lead.nextFollowUpAt,
      day: dayDiff <= 0 ? "today" : dayDiff === 1 ? "tomorrow" : "later",
    };
  }
  return state === "notContacted"
    ? { kind: "FIRST_CONTACT", urgent: false }
    : { kind: "SCHEDULE_FOLLOW_UP", urgent: false };
}

/** Shown as "new to you" only for open leads this employee has not opened yet. */
export function isNewToViewer(lead: LeadStateInput & { viewedByMe?: boolean }): boolean {
  if (lead.viewedByMe !== false) return false;
  const state = leadWorkflowState(lead);
  return state !== "converted" && state !== "closed";
}
