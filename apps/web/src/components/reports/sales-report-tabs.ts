import type { SalesReportScope } from "@/services/sales-reports-service";

export type ReportTab = "live" | "own" | "employees" | "teams" | "comparison" | "paymentMix";

/** OWN / AGENT_OWN: the response holds the caller's own figures and own rank only. */
export function isOwnReportScope(scope: SalesReportScope): boolean {
  return scope === "OWN" || scope === "AGENT_OWN";
}

/**
 * The report tabs for the scope the API answered with (R15 D15-18). Tabs
 * about other people (Employees / Teams / Comparison) exist only when the
 * scope has others; an own scope gets "My performance" (own figures + own
 * rank). Teams are company-only (TEAM / ALL); the agent team view is the
 * API's AGENT_ALL scope (`agent.reports.view_team`). Until the first answer
 * only Live (the default tab, which reads the scope) is offered. The API
 * already omits what a tab would show — this only avoids empty tabs.
 */
export function reportTabs(scope: SalesReportScope | null): ReportTab[] {
  if (scope === null) return ["live"];
  if (isOwnReportScope(scope)) return ["live", "own", "paymentMix"];
  if (scope === "AGENT_ALL") return ["live", "employees", "comparison", "paymentMix"];
  return ["live", "employees", "teams", "comparison", "paymentMix"];
}
