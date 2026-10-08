import { Injectable } from '@nestjs/common';
import { AgentStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { AgentStatementService } from '../finance/agent-statement.service';
import { agentNotFoundError } from '../common/agent-errors';
import {
  AGENT_ORDER_FIGURES_SELECT,
  agentOrderFigures,
  emptyLeadCounts,
  groupBy,
  sumLeadCounts,
  teamBreakdown,
} from './agent-order-figures';
import {
  agentTeamMembers,
  leadCounts,
  leadCountsBy,
} from './agent-overview-queries';

/** Money of the overviews (sales, collections, statement position) needs the agent-finance right. */
const FINANCE_VIEW = 'agents.finance.view';
/** The per-employee breakdown names the agent's users — the Team tab's right. */
const TEAM_VIEW = 'agents.users.view';

const AGENT_SELECT = {
  id: true,
  agentNumber: true,
  name: true,
  status: true,
  currencyId: true,
  currency: { select: { id: true, code: true, name: true } },
} satisfies Prisma.AgentSelect;

type OverviewAgent = Prisma.AgentGetPayload<{ select: typeof AGENT_SELECT }>;

const publicAgent = (agent: OverviewAgent) => ({
  id: agent.id,
  agentNumber: agent.agentNumber,
  name: agent.name,
  status: agent.status,
  currency: agent.currency,
});

/** Not cancelled (an order without a fulfillment status yet is live). */
const NOT_CANCELLED: Prisma.StoreOrderWhereInput = {
  OR: [
    { fulfillmentStatusId: null },
    { fulfillmentStatus: { code: { not: 'CANCELLED' } } },
  ],
};

/**
 * Company views of agent activity (R15 W1, spec 1.1–1.6): the cross-agent
 * overview of the Agents page and one agent's Overview tab. Stage counts,
 * returns and leads need `agents.view`; money (sales, delivered value,
 * collections, statement position, payouts) is present only with
 * `agents.finance.view` — absent, never zero, otherwise. Figures come from
 * the shared order math (`agentOrderFigures`) and the statement service's
 * dashboard money — nothing is recomputed here.
 */
@Injectable()
export class AgentOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionsResolverService,
    private readonly statements: AgentStatementService,
  ) {}

  /** Company-wide counts, plus per-agent figures for the requested agents (the caller's list page). */
  async overview(userId: string, agentIds: readonly string[] = []) {
    const finance = await this.resolver.hasPermission(userId, FINANCE_VIEW);
    const [totals, items] = await Promise.all([
      this.totals(finance),
      this.agentRows([...new Set(agentIds)], finance),
    ]);
    return { finance, totals, items };
  }

  /** One agent's Overview tab. */
  async agentOverview(userId: string, agentId: string) {
    const [finance, teamVisible, agent] = await Promise.all([
      this.resolver.hasPermission(userId, FINANCE_VIEW),
      this.resolver.hasPermission(userId, TEAM_VIEW),
      this.prisma.agent.findFirst({
        where: { id: agentId, deletedAt: null },
        select: AGENT_SELECT,
      }),
    ]);
    if (!agent) throw agentNotFoundError('Agent', 'الوكيل');
    const [orders, leadsByEmployee, members, money] = await Promise.all([
      this.prisma.storeOrder.findMany({
        where: { agentId, deletedAt: null },
        select: AGENT_ORDER_FIGURES_SELECT,
      }),
      leadCountsBy(this.prisma, { agentId }, 'salesEmployeeId'),
      teamVisible ? agentTeamMembers(this.prisma, agentId) : null,
      finance
        ? this.statements.dashboardMoney(agentId, agent.currencyId)
        : null,
    ]);
    const figures = agentOrderFigures(orders, agent.currencyId);
    return {
      agent: publicAgent(agent),
      finance,
      fulfillment: figures.fulfillment,
      returnCount: figures.returnCount,
      leads: sumLeadCounts(leadsByEmployee.values()),
      ...(money
        ? { sales: figures.sales, delivered: figures.delivered, ...money }
        : {}),
      ...(members
        ? {
            team: teamBreakdown(
              members,
              orders,
              leadsByEmployee,
              agent.currencyId,
              { money: finance },
            ),
          }
        : {}),
    };
  }

  private async totals(finance: boolean) {
    const orders: Prisma.StoreOrderWhereInput = {
      agentId: { not: null },
      deletedAt: null,
      agent: { deletedAt: null },
      ...NOT_CANCELLED,
    };
    const [agents, activeAgents, openOrders, withReturns, leads, awaiting] =
      await Promise.all([
        this.prisma.agent.count({ where: { deletedAt: null } }),
        this.prisma.agent.count({
          where: { deletedAt: null, status: AgentStatus.ACTIVE },
        }),
        this.prisma.storeOrder.count({
          where: { ...orders, agentEarnedAt: null },
        }),
        this.prisma.storeOrder.count({
          where: { ...orders, agentReturns: { some: {} } },
        }),
        leadCounts(this.prisma, {
          agentId: { not: null },
          agent: { deletedAt: null },
        }),
        finance
          ? this.prisma.payment.count({
              where: {
                agentId: { not: null },
                deletedAt: null,
                status: { in: [PaymentStatus.PENDING, PaymentStatus.MATCHED] },
              },
            })
          : null,
      ]);
    return {
      agents: { total: agents, active: activeAgents },
      orders: { open: openOrders, withReturns },
      leads,
      ...(awaiting !== null
        ? { collections: { awaitingVerificationCount: awaiting } }
        : {}),
    };
  }

  /** Per-agent figures in the requested order: one orders query and three lead counts for the whole page. */
  private async agentRows(ids: string[], finance: boolean) {
    if (ids.length === 0) return [];
    const found = await this.prisma.agent.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: AGENT_SELECT,
    });
    const agents = ids
      .map((id) => found.find((agent) => agent.id === id))
      .filter((agent): agent is OverviewAgent => Boolean(agent));
    const agentIds = agents.map((agent) => agent.id);
    const [orders, leads, money] = await Promise.all([
      this.prisma.storeOrder.findMany({
        where: { agentId: { in: agentIds }, deletedAt: null },
        select: AGENT_ORDER_FIGURES_SELECT,
      }),
      leadCountsBy(this.prisma, { agentId: { in: agentIds } }, 'agentId'),
      finance
        ? Promise.all(
            agents.map((agent) =>
              this.statements.dashboardMoney(agent.id, agent.currencyId),
            ),
          )
        : null,
    ]);
    const byAgent = groupBy(orders, (order) => order.agentId);
    return agents.map((agent, index) => {
      const figures = agentOrderFigures(
        byAgent.get(agent.id) ?? [],
        agent.currencyId,
      );
      const agentMoney = money?.[index];
      return {
        agent: publicAgent(agent),
        fulfillment: figures.fulfillment,
        returnCount: figures.returnCount,
        leads: leads.get(agent.id) ?? emptyLeadCounts(),
        ...(agentMoney
          ? {
              sales: figures.sales,
              delivered: figures.delivered,
              collections: agentMoney.collections,
              position: agentMoney.position,
            }
          : {}),
      };
    });
  }
}
