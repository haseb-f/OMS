import { describe, expect, it } from "vitest";
import { leadStage } from "@/components/crm/pilot/lead-stage-indicator";
import { planLeadNextActions } from "@/components/crm/lead-next-actions";
import type { LeadRow } from "@/services/leads-service";

const t = ((key: string) => key) as never;
const noop = () => {};
const handlers = { onFollowUp: noop, onConvert: noop, onAssign: noop, onClose: noop };
const NOW = Date.parse("2026-09-28T12:00:00Z");

function lead(partial: Partial<LeadRow>): LeadRow {
  return {
    status: { code: "IN_PROGRESS" },
    salesEmployeeId: "u1",
    salesEmployee: { fullName: "A" },
    nextFollowUpAt: null,
    ...partial,
  } as LeadRow;
}

describe("leadStage", () => {
  it("maps workflow codes onto the four stages", () => {
    expect(leadStage("NEW")).toEqual({ index: 0, closed: false });
    expect(leadStage("IN_PROGRESS")).toEqual({ index: 1, closed: false });
    expect(leadStage("FOLLOW_UP")).toEqual({ index: 1, closed: false });
    expect(leadStage("QUALIFIED")).toEqual({ index: 2, closed: false });
    expect(leadStage("CONVERTED")).toEqual({ index: 3, closed: false });
  });
  it("treats LOST / DISQUALIFIED as closed", () => {
    expect(leadStage("LOST").closed).toBe(true);
    expect(leadStage("DISQUALIFIED").closed).toBe(true);
  });
});

describe("planLeadNextActions (one next action by workflow priority)", () => {
  const perms = { canEdit: true, canConvert: true, canAssign: true, ...handlers };

  it("converts a qualified lead (green)", () => {
    const plan = planLeadNextActions(
      { lead: lead({ status: { code: "QUALIFIED" } as never }), ...perms },
      t,
      NOW,
    );
    expect(plan.primary).toMatchObject({ key: "convert", variant: "success" });
    expect(plan.secondary.find((a) => a.key === "convert")?.hidden).toBe(true);
  });

  it("assigns an unassigned lead", () => {
    const plan = planLeadNextActions(
      { lead: lead({ salesEmployeeId: null, salesEmployee: null } as never), ...perms },
      t,
      NOW,
    );
    expect(plan.primary?.key).toBe("assign");
  });

  it("flags an overdue follow-up as a warning", () => {
    const plan = planLeadNextActions(
      { lead: lead({ nextFollowUpAt: "2026-09-27T12:00:00Z" }), ...perms },
      t,
      NOW,
    );
    expect(plan.primary).toMatchObject({ key: "followUp", variant: "warning" });
  });

  it("falls back to adding a follow-up", () => {
    const plan = planLeadNextActions({ lead: lead({}), ...perms }, t, NOW);
    expect(plan.primary).toMatchObject({ key: "followUp", variant: "default" });
  });
});
