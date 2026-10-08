import type { Prisma } from '@prisma/client';

/**
 * R15 (decision D15-18) — whose SALES FIGURES a caller may read: every sales
 * report, chart, ranking and dashboard figure, company and agent. Separate
 * from the list / by-id record scope (`SalesScope`): browsing records
 * (`store-orders.view_all`, `crm.leads.manage`, `agent.records.view_all`)
 * never widens figures.
 *
 * Company (`SalesScopeService.resolveReportScope`):
 *   `reports.sales.view_all` (or Super Admin) -> ALL  (every company owner)
 *   active sales-team manager                 -> TEAM (own + members)
 *   anyone else                               -> OWN  (own figures + own rank)
 * Agent (`resolveAgentReportScope`):
 *   `agent.reports.view_team`                 -> AGENT_ALL (the whole agent)
 *   anyone else                               -> AGENT_OWN
 * Company figures always exclude agent orders / leads.
 */
export interface CompanyReportScope {
  audience: 'company';
  label: 'ALL' | 'TEAM' | 'OWN';
  userId: string;
  /** null = every company owner (ALL). */
  ownerIds: string[] | null;
}

export interface AgentReportScope {
  audience: 'agent';
  label: 'AGENT_ALL' | 'AGENT_OWN';
  userId: string;
  agentId: string;
  /** null = every employee of the caller's agent (team view). */
  ownerUserId: string | null;
}

export type ReportScope = CompanyReportScope | AgentReportScope;

/** Leads counted in a company report-scope figure (internal leads only). */
export function reportLeadWhere(
  scope: CompanyReportScope,
): Prisma.LeadWhereInput {
  if (!scope.ownerIds) return { agentId: null };
  return { agentId: null, salesEmployeeId: { in: scope.ownerIds } };
}
