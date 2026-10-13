import { describe, expect, it } from "vitest";
import { isUnopenedByAssignee, leadNextAction, leadWorkflowState } from "./lead-grid-state";

const NOW = new Date(2026, 9, 3, 12, 0, 0);
const code = (c: string) => ({ status: { code: c } });

describe("leadWorkflowState", () => {
  it("maps real workflow codes to the four card states", () => {
    expect(leadWorkflowState(code("NEW"))).toBe("notContacted");
    expect(leadWorkflowState(code("IN_PROGRESS"))).toBe("followingUp");
    expect(leadWorkflowState(code("QUALIFIED"))).toBe("followingUp");
    expect(leadWorkflowState(code("CONVERTED"))).toBe("converted");
    expect(leadWorkflowState(code("LOST"))).toBe("closed");
    expect(leadWorkflowState(code("DISQUALIFIED"))).toBe("closed");
  });

  it("a NEW lead with an outcome or a scheduled follow-up is already being followed", () => {
    expect(leadWorkflowState({ ...code("NEW"), followUpOutcome: "noAnswer" })).toBe("followingUp");
    expect(leadWorkflowState({ ...code("NEW"), nextFollowUpAt: NOW.toISOString() })).toBe(
      "followingUp",
    );
  });
});

describe("leadNextAction", () => {
  it("offers nothing on converted or closed leads", () => {
    expect(leadNextAction(code("CONVERTED"), { now: NOW })).toBeNull();
    expect(leadNextAction(code("LOST"), { now: NOW })).toBeNull();
  });

  it("assign comes first, only for someone who can assign and an unassigned lead", () => {
    const lead = { ...code("NEW"), salesEmployeeId: null };
    expect(leadNextAction(lead, { canAssign: true, now: NOW })?.kind).toBe("ASSIGN");
    expect(leadNextAction(lead, { canAssign: false, now: NOW })?.kind).toBe("FIRST_CONTACT");
    expect(
      leadNextAction({ ...lead, salesEmployeeId: "u1" }, { canAssign: true, now: NOW })?.kind,
    ).toBe("FIRST_CONTACT");
  });

  it("flags an overdue follow-up as urgent, today/tomorrow/later as scheduled", () => {
    const base = code("IN_PROGRESS");
    const at = (d: Date) => d.toISOString();
    expect(
      leadNextAction({ ...base, nextFollowUpAt: at(new Date(2026, 9, 1, 9)) }, { now: NOW }),
    ).toMatchObject({ kind: "FOLLOW_UP_OVERDUE", urgent: true });
    expect(
      leadNextAction({ ...base, nextFollowUpAt: at(new Date(2026, 9, 3, 9)) }, { now: NOW }),
    ).toMatchObject({ kind: "FOLLOW_UP_SCHEDULED", day: "today", urgent: false });
    expect(
      leadNextAction({ ...base, nextFollowUpAt: at(new Date(2026, 9, 4, 9)) }, { now: NOW }),
    ).toMatchObject({ day: "tomorrow" });
    expect(
      leadNextAction({ ...base, nextFollowUpAt: at(new Date(2026, 9, 9, 9)) }, { now: NOW }),
    ).toMatchObject({ day: "later" });
  });

  it("an open lead with nothing scheduled asks for a follow-up; convert wins when allowed", () => {
    expect(leadNextAction(code("IN_PROGRESS"), { now: NOW })?.kind).toBe("SCHEDULE_FOLLOW_UP");
    expect(leadNextAction(code("IN_PROGRESS"), { canConvert: true, now: NOW })?.kind).toBe(
      "CONVERT",
    );
    expect(
      leadNextAction({ ...code("IN_PROGRESS"), storeOrder: { id: "o" } }, { canConvert: true })
        ?.kind,
    ).toBe("SCHEDULE_FOLLOW_UP");
  });
});

describe("isUnopenedByAssignee (R20 — follows the assignee, independent of business status)", () => {
  const owned = (statusCode: string, openedByAssigneeAt: string | null | undefined) => ({
    ...code(statusCode),
    salesEmployeeId: "u1",
    openedByAssigneeAt,
  });

  it("shows only for open, assigned leads the assignee has not opened", () => {
    expect(isUnopenedByAssignee(owned("NEW", null))).toBe(true);
    expect(isUnopenedByAssignee(owned("IN_PROGRESS", null))).toBe(true);
    expect(isUnopenedByAssignee(owned("NEW", "2026-10-13T08:00:00.000Z"))).toBe(false);
    expect(isUnopenedByAssignee(owned("IN_PROGRESS", "2026-10-13T08:00:00.000Z"))).toBe(false);
    expect(isUnopenedByAssignee(owned("CONVERTED", null))).toBe(false);
    expect(isUnopenedByAssignee(owned("LOST", null))).toBe(false);
  });

  it("never marks an unassigned lead or a payload that does not say", () => {
    expect(
      isUnopenedByAssignee({ ...code("NEW"), salesEmployeeId: null, openedByAssigneeAt: null }),
    ).toBe(false);
    expect(isUnopenedByAssignee({ ...code("NEW"), salesEmployeeId: "u1" })).toBe(false);
  });

  it("is not an input of the workflow state: opening never moves a lead between states", () => {
    const unopened = owned("NEW", null);
    const opened = owned("NEW", "2026-10-13T08:00:00.000Z");
    expect(leadWorkflowState(unopened)).toBe("notContacted");
    expect(leadWorkflowState(opened)).toBe("notContacted");
    expect(leadNextAction(unopened, { now: NOW })).toEqual(leadNextAction(opened, { now: NOW }));
  });
});
