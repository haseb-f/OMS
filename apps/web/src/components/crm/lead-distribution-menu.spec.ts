import { describe, expect, it } from "vitest";
import {
  describeDistributionControl,
  describeDistributionResult,
} from "@/components/crm/lead-distribution-menu";
import type { LeadDistributionSnapshot } from "@/services/leads-service";

function snap(partial: Partial<LeadDistributionSnapshot>): LeadDistributionSnapshot {
  return { policy: null, eligible: [{ id: "u1", fullName: "A", email: "a@x" }], ...partial };
}

describe("describeDistributionControl", () => {
  it("active automatic mode is green", () => {
    const d = describeDistributionControl(snap({ pendingEligibleCount: 0 }), "CONTINUOUS");
    expect(d).toMatchObject({ tone: "success", running: true, blocked: false });
  });
  it("an empty eligible pool under an automatic mode is red and explained", () => {
    const d = describeDistributionControl(
      snap({
        eligible: [],
        failureCode: "NO_ELIGIBLE_EMPLOYEES",
        failureReason: "No eligible sales employees.",
      }),
      "CONTINUOUS",
    );
    expect(d).toMatchObject({ tone: "destructive", blocked: true, emptyPool: true });
  });
  it("paused is amber and a pending backlog is a warning, not a failure", () => {
    const d = describeDistributionControl(
      snap({
        pendingEligibleCount: 3,
        failureCode: "PENDING_NOT_AUTO",
        failureReason: "Distribution is paused or manual.",
      }),
      "PAUSED",
    );
    expect(d).toMatchObject({ tone: "warning", blocked: false, pausedBacklog: true });
  });
  it("manual is neutral", () => {
    expect(describeDistributionControl(snap({}), "MANUAL").tone).toBe("neutral");
  });
});

describe("describeDistributionResult", () => {
  const run = { assigned: 0, skipped: 0, failureCode: null, failureReason: null };
  it("reports only what the server confirmed", () => {
    expect(describeDistributionResult({ ...run, assigned: 3 }, 0).kind).toBe("assigned");
    expect(describeDistributionResult(run, 0).kind).toBe("nothing");
    expect(describeDistributionResult({ ...run, alreadyRunning: true }, 2).kind).toBe(
      "alreadyRunning",
    );
    expect(
      describeDistributionResult(
        { ...run, skipped: 2, failureCode: "NO_ELIGIBLE_EMPLOYEES", failureReason: "x" },
        2,
      ),
    ).toEqual({ kind: "blocked", tone: "destructive" });
    expect(describeDistributionResult(null, 0).kind).toBe("saved");
  });
});
