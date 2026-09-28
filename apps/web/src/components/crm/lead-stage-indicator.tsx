"use client";

import { useEffect, useState } from "react";
import { WorkflowTracker } from "@/components/shared/workflow-tracker";
import { useLocale } from "@/providers/locale-provider";
import { workflowService, type StatusHistoryRow } from "@/services/workflow-service";

const STAGES = ["NEW", "IN_PROGRESS", "QUALIFIED", "CONVERTED"] as const;
type Stage = (typeof STAGES)[number];

/**
 * The LEAD workflow allows skipping (e.g. NEW → FOLLOW_UP → QUALIFIED,
 * IN_PROGRESS → CONVERTED), so these two are shown as completed only when
 * status history proves them (or while current).
 */
const OPTIONAL_STAGES: readonly Stage[] = ["IN_PROGRESS", "QUALIFIED"];
const CLOSED_CODES = ["LOST", "DISQUALIFIED"];

/**
 * Where a lead sits in its lifecycle, derived from `status.code` only:
 * NEW → (every working status) → QUALIFIED → CONVERTED. LOST/DISQUALIFIED
 * are a closed end state, not a step.
 */
export function leadStage(code: string | null | undefined): {
  index: number;
  closed: boolean;
} {
  if (code && CLOSED_CODES.includes(code)) return { index: -1, closed: true };
  const index = STAGES.indexOf(code as Stage);
  return { index: index === -1 ? 1 : index, closed: false };
}

/** Stage a status code belongs to (null for closed codes). */
function stageOf(code: string): Stage | null {
  if (CLOSED_CODES.includes(code)) return null;
  const index = leadStage(code).index;
  return STAGES[index];
}

/**
 * Stages proven completed: NEW (every lead is created in the default NEW
 * status) once the lead has moved on, any stage the status history shows the
 * lead in before its current stage, and CONVERTED itself when converted.
 * Without history (`null`, e.g. it failed to load) only the current status
 * counts, so skippable stages are never assumed.
 */
export function leadCompletedStages(
  code: string | null | undefined,
  history: readonly Pick<StatusHistoryRow, "fromStatus" | "toStatus">[] | null,
): Set<Stage> {
  const { index, closed } = leadStage(code);
  const limit = closed ? STAGES.length - 1 : index; // closed: anything before CONVERTED
  const done = new Set<Stage>();
  if (closed || index > 0) done.add("NEW");
  for (const row of history ?? []) {
    for (const status of [row.fromStatus, row.toStatus]) {
      const stage = status ? stageOf(status.code) : null;
      if (stage && STAGES.indexOf(stage) < limit) done.add(stage);
    }
  }
  if (!closed && STAGES[index] === "CONVERTED") done.add("CONVERTED");
  return done;
}

/** Lead stage tracker (design-system §12.6), on the shared WorkflowTracker (§12.7). */
export function LeadStageIndicator({
  leadId,
  statusCode,
  closedLabel,
  className,
}: {
  /** Loads the lead's status history to prove skippable stages. */
  leadId?: string;
  statusCode: string | null | undefined;
  /** Name of the closing status (e.g. «غير مؤهل»), shown on the closed marker. */
  closedLabel?: string;
  className?: string;
}) {
  const { t } = useLocale();
  const { index, closed } = leadStage(statusCode);
  const [history, setHistory] = useState<{ key: string; rows: StatusHistoryRow[] } | null>(null);
  const historyKey = `${leadId ?? ""}:${statusCode ?? ""}`;

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    workflowService
      .statusHistory("LEAD", leadId)
      .then((rows) => {
        if (!cancelled) setHistory({ key: historyKey, rows: Array.isArray(rows) ? rows : [] });
      })
      // Failure: fall back to what the current status proves (no toast — read-only aid).
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [leadId, historyKey]);

  const rows = history?.key === historyKey ? history.rows : null;

  return (
    <WorkflowTracker
      label={t("crm.leads.stage.label")}
      stages={STAGES.map((stage) => ({
        key: stage,
        // Same wording as the lead status badge (workflow stage names).
        label: t(`workflow.funnel.stages.${stage}`),
        optional: OPTIONAL_STAGES.includes(stage),
      }))}
      current={closed ? null : STAGES[index]}
      completed={leadCompletedStages(statusCode, rows)}
      state={
        closed ? { label: closedLabel ?? t("crm.leads.stage.closed"), tone: "destructive" } : null
      }
      className={className}
    />
  );
}
