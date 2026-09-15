import { describe, expect, it } from "vitest";
import { leadLifecycleBadge } from "./lead-columns";
import type { LeadStatusSnapshot } from "@/services/leads-service";

function status(overrides: Partial<LeadStatusSnapshot>): LeadStatusSnapshot {
  return {
    id: "status-1",
    code: "NEW",
    name: "New",
    nameEn: "New",
    color: "info",
    isFinal: false,
    ...overrides,
  };
}

/**
 * Regression for the Lead initial ownership lifecycle (NEW/unassigned =
 * blue vs. ASSIGNED = orange). This is a presentation-only derivation over
 * `status.code === "NEW"` + `salesEmployeeId` — never a second status field
 * (the ASSIGNED/CONTACTED statuses were deliberately retired in migration
 * 20260906090000_lead_status_simplification after confirming zero historical
 * usage). Reassignment must never revert a Lead to "New".
 */
describe("leadLifecycleBadge", () => {
  const assignedLabel = "Assigned";

  it("renders unassigned NEW leads as the blue/info status label", () => {
    const badge = leadLifecycleBadge(
      { status: status({ code: "NEW", name: "New" }), salesEmployeeId: null },
      assignedLabel,
    );
    expect(badge).toEqual({ label: "New", colorKey: "info" });
  });

  it("renders an assigned NEW lead as the orange/warning 'Assigned' label", () => {
    const badge = leadLifecycleBadge(
      { status: status({ code: "NEW" }), salesEmployeeId: "emp-1" },
      assignedLabel,
    );
    expect(badge).toEqual({ label: assignedLabel, colorKey: "warning" });
  });

  it("stays 'Assigned' after reassignment to a different employee (never reverts to New)", () => {
    const first = leadLifecycleBadge(
      { status: status({ code: "NEW" }), salesEmployeeId: "emp-1" },
      assignedLabel,
    );
    const reassigned = leadLifecycleBadge(
      { status: status({ code: "NEW" }), salesEmployeeId: "emp-2" },
      assignedLabel,
    );
    expect(first).toEqual(reassigned);
    expect(reassigned.label).toBe(assignedLabel);
  });

  it("passes through later workflow statuses unchanged, regardless of salesEmployeeId", () => {
    const badge = leadLifecycleBadge(
      {
        status: status({ code: "QUALIFIED", name: "Qualified", color: "success" }),
        salesEmployeeId: "emp-1",
      },
      assignedLabel,
    );
    expect(badge).toEqual({ label: "Qualified", colorKey: "success" });
  });

  it("falls back to an em dash when status is missing", () => {
    const badge = leadLifecycleBadge(
      { status: undefined as unknown as LeadStatusSnapshot, salesEmployeeId: null },
      assignedLabel,
    );
    expect(badge).toEqual({ label: "—", colorKey: undefined });
  });
});
