import { describe, expect, it } from "vitest";
import { leadCompletedStages } from "@/components/crm/pilot/lead-stage-indicator";
import { resolveWorkflowTrack } from "@/components/shared/workflow-tracker";

const STAGES = ["NEW", "IN_PROGRESS", "QUALIFIED", "CONVERTED"];
const OPTIONAL = ["IN_PROGRESS", "QUALIFIED"];
const CURRENT: Record<string, string | null> = {
  NEW: "NEW",
  FOLLOW_UP: "IN_PROGRESS",
  CONTACTED: "IN_PROGRESS",
  QUALIFIED: "QUALIFIED",
  CONVERTED: "CONVERTED",
  LOST: null,
};

const h = (from: string | null, to: string) => ({
  fromStatus: from ? { code: from, name: from, color: "neutral" } : null,
  toStatus: { code: to, name: to, color: "neutral" },
});

/** What the tracker shows for a lead status + history. */
function shown(code: string, history: ReturnType<typeof h>[] | null) {
  const r = resolveWorkflowTrack({
    stages: STAGES.map((key) => ({ key, label: key, optional: OPTIONAL.includes(key) })),
    current: CURRENT[code],
    completed: leadCompletedStages(code, history),
    state: CURRENT[code] === null ? { label: code, tone: "destructive" } : null,
  });
  return r.steps.map((s) => `${s.key}:${s.done ? "done" : s.current ? "current" : "next"}`);
}

describe("lead stages from status history", () => {
  it("does not assume skippable stages without history", () => {
    expect(shown("CONVERTED", null)).toEqual(["NEW:done", "CONVERTED:done"]);
    expect(shown("QUALIFIED", null)).toEqual(["NEW:done", "QUALIFIED:current", "CONVERTED:next"]);
    expect(shown("NEW", null)).toEqual(["NEW:current", "CONVERTED:next"]);
  });

  it("shows In progress / Qualified only when history proves them", () => {
    // NEW → FOLLOW_UP → CONVERTED (skipped QUALIFIED)
    expect(shown("CONVERTED", [h("FOLLOW_UP", "CONVERTED"), h("NEW", "FOLLOW_UP")])).toEqual([
      "NEW:done",
      "IN_PROGRESS:done",
      "CONVERTED:done",
    ]);
    // NEW → QUALIFIED → CONVERTED (skipped working statuses)
    expect(shown("CONVERTED", [h("QUALIFIED", "CONVERTED"), h("NEW", "QUALIFIED")])).toEqual([
      "NEW:done",
      "QUALIFIED:done",
      "CONVERTED:done",
    ]);
    // Working status is current: shown as current, not completed.
    expect(shown("FOLLOW_UP", [h("NEW", "FOLLOW_UP")])).toEqual([
      "NEW:done",
      "IN_PROGRESS:current",
      "CONVERTED:next",
    ]);
  });

  it("keeps proven stages of a closed lead, nothing more", () => {
    expect(shown("LOST", [h("CONTACTED", "LOST"), h("NEW", "CONTACTED")])).toEqual([
      "NEW:done",
      "IN_PROGRESS:done",
      "CONVERTED:next",
    ]);
    expect(shown("LOST", null)).toEqual(["NEW:done", "CONVERTED:next"]);
  });
});
