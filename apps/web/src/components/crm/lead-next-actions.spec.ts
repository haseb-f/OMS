import { describe, expect, it } from "vitest";
import { isLeadStartFollowUp, planLeadPilotActions } from "@/components/crm/lead-next-actions";
import type { WorkflowActionItem } from "@/components/business/workflow-actions-panel";
import type { LeadRow } from "@/services/leads-service";

const t = ((key: string) => key) as never;
const noop = () => {};
const handlers = { onFollowUp: noop, onConvert: noop, onAssign: noop, onClose: noop };
const perms = { canEdit: true, canConvert: true, canAssign: true, ...handlers };
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

function transition(partial: Partial<WorkflowActionItem>): WorkflowActionItem {
  return {
    key: "t1",
    label: "T",
    toStatusCode: "QUALIFIED",
    requiresReason: false,
    businessAction: "NONE",
    disabled: false,
    loading: false,
    onSelect: noop,
    ...partial,
  };
}

const start = transition({ key: "start", label: "بدء المتابعة", toStatusCode: "IN_PROGRESS" });

describe("isLeadStartFollowUp", () => {
  it("matches only the plain NEW → IN_PROGRESS transition", () => {
    expect(isLeadStartFollowUp("NEW", start)).toBe(true);
    expect(isLeadStartFollowUp("IN_PROGRESS", start)).toBe(false);
    expect(isLeadStartFollowUp("LOST", start)).toBe(false);
    expect(isLeadStartFollowUp("NEW", { ...start, requiresReason: true })).toBe(false);
    expect(isLeadStartFollowUp("NEW", { ...start, businessAction: "LEAD_CONVERT" })).toBe(false);
  });
});

describe("planLeadPilotActions (Add Follow-up → Convert → More)", () => {
  it("presents follow-up, green convert, and transitions in More", () => {
    const plan = planLeadPilotActions(
      { lead: lead({}), ...perms },
      [transition({ label: "تأهيل" })],
      t,
      NOW,
    );
    expect(plan.followUp).toMatchObject({ key: "followUp", variant: "outline" });
    expect(plan.convert).toMatchObject({ key: "convert", variant: "success" });
    expect(plan.more.map((a) => a.key)).toEqual(["transition-t1", "assign"]);
    expect(plan.destructive.map((a) => a.key)).toEqual(["close"]);
  });

  it("folds Start follow-up into Add Follow-up on a NEW lead", () => {
    const plan = planLeadPilotActions(
      { lead: lead({ status: { code: "NEW" } as never }), ...perms },
      [start],
      t,
      NOW,
    );
    expect(plan.more.some((a) => a.label === "بدء المتابعة")).toBe(false);
    expect(plan.followUp?.key).toBe("followUp");
  });

  it("keeps Start follow-up reachable when the user cannot add a follow-up", () => {
    const plan = planLeadPilotActions(
      { lead: lead({ status: { code: "NEW" } as never }), ...perms, canEdit: false },
      [start],
      t,
      NOW,
    );
    expect(plan.followUp).toBeUndefined();
    expect(plan.more.some((a) => a.label === "بدء المتابعة")).toBe(true);
  });

  it("puts Assign first in More while unassigned; hides it without permission", () => {
    const unassigned = lead({ salesEmployeeId: null, salesEmployee: null } as never);
    const plan = planLeadPilotActions({ lead: unassigned, ...perms }, [transition({})], t, NOW);
    expect(plan.more[0]).toMatchObject({ key: "assign", label: "crm.leads.actions.assign" });
    const denied = planLeadPilotActions(
      { lead: unassigned, ...perms, canAssign: false },
      [],
      t,
      NOW,
    );
    expect(denied.more.find((a) => a.key === "assign")?.hidden).toBe(true);
  });

  it("emphasizes an overdue follow-up and makes follow-up primary without convert", () => {
    const overdue = planLeadPilotActions(
      { lead: lead({ nextFollowUpAt: "2026-09-27T12:00:00Z" }), ...perms },
      [],
      t,
      NOW,
    );
    expect(overdue.followUp?.variant).toBe("warning");
    const noConvert = planLeadPilotActions(
      { lead: lead({}), ...perms, canConvert: false },
      [],
      t,
      NOW,
    );
    expect(noConvert.convert).toBeUndefined();
    expect(noConvert.followUp?.variant).toBe("default");
  });

  it("disables the group and surfaces the running transition", () => {
    const running = transition({ loading: true, disabled: true });
    const plan = planLeadPilotActions({ lead: lead({}), ...perms }, [running], t, NOW);
    expect(plan.running).toBe(running);
    expect(plan.followUp?.disabled).toBe(true);
    expect(plan.convert?.disabled).toBe(true);
    const busy = planLeadPilotActions({ lead: lead({}), ...perms, followUpBusy: true }, [], t, NOW);
    expect(busy.followUp?.loading).toBe(true);
    expect(busy.convert?.disabled).toBe(true);
  });
});
