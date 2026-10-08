import { describe, expect, it } from "vitest";
import { isOwnReportScope, reportTabs } from "./sales-report-tabs";

describe("reportTabs — tabs follow the API's report scope (R15 D15-18)", () => {
  it("offers only Live until the first answer names the scope", () => {
    expect(reportTabs(null)).toEqual(["live"]);
  });

  it("own scopes get My performance, never a tab about other people", () => {
    for (const scope of ["OWN", "AGENT_OWN"] as const) {
      expect(isOwnReportScope(scope)).toBe(true);
      expect(reportTabs(scope)).toEqual(["live", "own", "paymentMix"]);
    }
  });

  it("the agent team view (agent.reports.view_team) has employees and comparison, never company teams", () => {
    expect(reportTabs("AGENT_ALL")).toEqual(["live", "employees", "comparison", "paymentMix"]);
  });

  it("a team manager and a company-wide viewer get every tab", () => {
    for (const scope of ["TEAM", "ALL"] as const) {
      expect(isOwnReportScope(scope)).toBe(false);
      expect(reportTabs(scope)).toEqual(["live", "employees", "teams", "comparison", "paymentMix"]);
    }
  });
});
