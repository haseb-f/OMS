import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SalesScopeService } from '../sales-scope/sales-scope.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import type { AgentRequestContext } from '../auth/guards/jwt-auth.guard';
import { resolveAgentVisibility } from '../agents/common/agent-visibility';
import { BUSINESS_TIME_ZONE } from '../common/time/business-date';
import {
  CANCELLED_STATUS,
  MAX_REPORT_RANGE_DAYS,
  ORDER_AMOUNT_SQL,
  ORDER_STATUS_CODE_SQL,
  SalesTally,
  defaultPerformanceRange,
  livePeriodRanges,
  periodRange,
  rangeDays,
  rankEntries,
  roundAmount,
  type LivePeriod,
  type RankBy,
  type SalesStats,
} from './sales-metrics';
import type { SalesPerformanceQueryDto } from './dto/sales-performance-query.dto';

/** Upper bound of ranked employees per response (single grouped query). */
export const MAX_RANKED_EMPLOYEES = 200;
/** Upper bound of teams per response. */
export const MAX_TEAMS = 100;

export type SalesReportScopeLabel =
  'ALL' | 'TEAM' | 'OWN' | 'NONE' | 'AGENT_ALL' | 'AGENT_OWN';

/**
 * Who the report is about. Company users: `SalesScopeService` (the same
 * rule as `storeOrderWhere` — OWN = own orders, TEAM = own + managed team
 * members, ALL = every owner); company figures always exclude agent orders,
 * which an ALL viewer sees as a separate "Agents" row. Agent users:
 * `resolveAgentVisibility` (admin with view_all = the agent's orders, sales =
 * own), never another agent's.
 */
type ReportScope =
  | {
      audience: 'company';
      label: 'ALL' | 'TEAM' | 'OWN' | 'NONE';
      userId: string;
      /** null = every company owner. */
      ownerIds: string[] | null;
    }
  | {
      audience: 'agent';
      label: 'AGENT_ALL' | 'AGENT_OWN';
      agentId: string;
      ownerUserId: string | null;
    };

export interface LiveBucket extends SalesStats {
  period: LivePeriod;
  from: string;
  to: string;
  statusBreakdown: Array<{ code: string; count: number }>;
}

export interface LiveReport {
  scope: SalesReportScopeLabel;
  timeZone: string;
  generatedAt: string;
  periods: LiveBucket[];
}

export interface RankedEmployee extends SalesStats {
  rank: number;
  rankValue: number;
  /** null = orders without an owner ("Unassigned"). */
  userId: string | null;
  name: string | null;
}

export interface RankedTeam extends SalesStats {
  rank: number;
  rankValue: number;
  teamId: string;
  name: string;
  manager: { userId: string; name: string };
  members: Array<{ userId: string; name: string }>;
}

export interface PaymentMixRow {
  currencyCode: string;
  prepaid: { count: number; amount: number };
  cod: { count: number; amount: number };
}

export interface PerformanceReport {
  scope: SalesReportScopeLabel;
  timeZone: string;
  generatedAt: string;
  from: string;
  to: string;
  rankBy: RankBy;
  currency: string | null;
  /** Currencies with valid sales in the range (for the rank-by control). */
  currencies: string[];
  employees: RankedEmployee[];
  employeesTruncated: boolean;
  /** null when the viewer's scope has no team view (OWN / agent portal). */
  teams: RankedTeam[] | null;
  /** Agent orders as one separate row — ALL scope only, never mixed in. */
  agents: SalesStats | null;
  paymentMix: PaymentMixRow[];
}

interface GroupedRow {
  key: string | null;
  currency_code: string;
  status_code: string;
  count: number;
  amount: Prisma.Decimal | string | null;
}

/** UTC instant as a `timestamp` (store_orders.order_date is UTC wall time). */
function ts(instant: Date): Prisma.Sql {
  return Prisma.sql`(${instant.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

function uuidList(ids: string[]): Prisma.Sql {
  return Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
}

@Injectable()
export class SalesReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesScope: SalesScopeService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  // -------------------------------------------------------------------------
  // Scope
  // -------------------------------------------------------------------------

  async companyScope(userId: string): Promise<ReportScope> {
    const scope = await this.salesScope.resolve(userId);
    // Mirrors `SalesScopeService.storeOrderWhere`: ALL or the explicit
    // `store-orders.view_all` grant see every owner.
    if (scope.kind === 'ALL' || scope.canViewAllOrders) {
      return { audience: 'company', label: 'ALL', userId, ownerIds: null };
    }
    if (scope.kind === 'NONE' || !scope.ownerIds?.length) {
      return { audience: 'company', label: 'NONE', userId, ownerIds: [] };
    }
    return {
      audience: 'company',
      label: scope.kind,
      userId,
      ownerIds: scope.ownerIds,
    };
  }

  async agentScope(agent: AgentRequestContext): Promise<ReportScope> {
    const visibility = await resolveAgentVisibility(agent, this.permissions);
    return {
      audience: 'agent',
      label: visibility.ownerUserId ? 'AGENT_OWN' : 'AGENT_ALL',
      agentId: visibility.agentId,
      ownerUserId: visibility.ownerUserId,
    };
  }

  /** The order set the report covers (alias `o`). */
  private orderFilter(scope: ReportScope): Prisma.Sql {
    if (scope.audience === 'agent') {
      return scope.ownerUserId
        ? Prisma.sql`o.agent_id = ${scope.agentId}::uuid AND o.employee_id = ${scope.ownerUserId}::uuid`
        : Prisma.sql`o.agent_id = ${scope.agentId}::uuid`;
    }
    if (scope.label === 'NONE' || (scope.ownerIds && !scope.ownerIds.length)) {
      return Prisma.sql`FALSE`;
    }
    if (!scope.ownerIds) return Prisma.sql`o.agent_id IS NULL`;
    return Prisma.sql`o.agent_id IS NULL AND o.employee_id IN (${uuidList(scope.ownerIds)})`;
  }

  // -------------------------------------------------------------------------
  // Live
  // -------------------------------------------------------------------------

  async live(scope: ReportScope, now: Date = new Date()): Promise<LiveReport> {
    const ranges = livePeriodRanges(now);
    const tallies = new Map<LivePeriod, SalesTally>(
      ranges.map((range) => [range.period, new SalesTally()]),
    );
    const minStart = new Date(
      Math.min(...ranges.map((range) => range.start.getTime())),
    );
    const maxEnd = new Date(
      Math.max(...ranges.map((range) => range.endExclusive.getTime())),
    );
    const periods = Prisma.join(
      ranges.map(
        (range) =>
          Prisma.sql`(${range.period}::text, ${ts(range.start)}, ${ts(range.endExclusive)})`,
      ),
    );
    // ONE grouped query for all five cards: each order joins every period it
    // falls in (today ⊂ last 7 days ⊂ …), grouped by period × currency × status.
    const rows = await this.prisma.$queryRaw<
      Array<GroupedRow & { period: LivePeriod }>
    >(Prisma.sql`
      SELECT p.period AS period, NULL::text AS key, c.code AS currency_code,
             ${ORDER_STATUS_CODE_SQL} AS status_code,
             COUNT(*)::int AS count, SUM(${ORDER_AMOUNT_SQL}) AS amount
      FROM store_orders o
      JOIN (VALUES ${periods}) AS p(period, start_at, end_at)
        ON o.order_date >= p.start_at AND o.order_date < p.end_at
      JOIN currencies c ON c.id = o.currency_id
      LEFT JOIN status_definitions sd ON sd.id = o.fulfillment_status_id
      WHERE o.deleted_at IS NULL
        AND o.order_date >= ${ts(minStart)} AND o.order_date < ${ts(maxEnd)}
        AND ${this.orderFilter(scope)}
      GROUP BY 1, 3, 4`);
    for (const row of rows) {
      tallies.get(row.period)?.add({
        statusCode: row.status_code,
        currencyCode: row.currency_code,
        count: row.count,
        amount: row.amount,
      });
    }
    return {
      scope: scope.label,
      timeZone: BUSINESS_TIME_ZONE,
      generatedAt: now.toISOString(),
      periods: ranges.map((range) => {
        const tally = tallies.get(range.period) as SalesTally;
        return {
          period: range.period,
          from: range.from,
          to: range.to,
          ...tally.stats(),
          statusBreakdown: tally.statusBreakdown(),
        };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Performance (employees, teams, agents row, payment mix)
  // -------------------------------------------------------------------------

  private parsePerformanceQuery(query: SalesPerformanceQueryDto, now: Date) {
    const fallback = defaultPerformanceRange(now);
    const from = query.from ?? fallback.from;
    const to = query.to ?? fallback.to;
    let range;
    try {
      range = periodRange(from, to);
    } catch {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: 'from / to must be calendar dates (YYYY-MM-DD).',
      });
    }
    const days = rangeDays(range.from, range.to);
    if (days < 1) {
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: 'from must be on or before to.',
      });
    }
    if (days > MAX_REPORT_RANGE_DAYS) {
      throw new BadRequestException({
        code: 'RANGE_TOO_LONG',
        message: `The period may cover at most ${MAX_REPORT_RANGE_DAYS} days.`,
      });
    }
    const rankBy: RankBy = query.rankBy ?? 'count';
    const currency = query.currency ? query.currency.toUpperCase() : null;
    if (rankBy === 'amount' && !currency) {
      throw new BadRequestException({
        code: 'CURRENCY_REQUIRED',
        message:
          'Ranking by amount needs one currency — amounts in different currencies are never added together.',
      });
    }
    return { range, rankBy, currency };
  }

  async performance(
    scope: ReportScope,
    query: SalesPerformanceQueryDto,
    now: Date = new Date(),
  ): Promise<PerformanceReport> {
    const { range, rankBy, currency } = this.parsePerformanceQuery(query, now);
    const filter = this.orderFilter(scope);
    const window = Prisma.sql`o.deleted_at IS NULL AND o.order_date >= ${ts(range.start)} AND o.order_date < ${ts(range.endExclusive)}`;
    const fromOrders = Prisma.sql`
      FROM store_orders o
      JOIN currencies c ON c.id = o.currency_id
      LEFT JOIN status_definitions sd ON sd.id = o.fulfillment_status_id`;
    const cancelled = CANCELLED_STATUS;
    const rankCurrency = currency ?? '';
    const rankKey =
      rankBy === 'amount'
        ? Prisma.sql`rank_amount DESC, valid DESC`
        : Prisma.sql`valid DESC`;

    // 1. Employees — one grouped query, bounded to the top N owners by the
    //    same rank key (N + 1 fetched to report truncation).
    const employeesQuery = this.prisma.$queryRaw<GroupedRow[]>(Prisma.sql`
      WITH per AS (
        SELECT o.employee_id AS owner, c.code AS currency_code,
               ${ORDER_STATUS_CODE_SQL} AS status_code,
               COUNT(*)::int AS count, SUM(${ORDER_AMOUNT_SQL}) AS amount
        ${fromOrders}
        WHERE ${window} AND ${filter}
        GROUP BY 1, 2, 3
      ), ranked AS (
        SELECT owner,
               COALESCE(SUM(count) FILTER (WHERE status_code <> ${cancelled}), 0) AS valid,
               COALESCE(SUM(amount) FILTER (WHERE status_code <> ${cancelled} AND currency_code = ${rankCurrency}), 0) AS rank_amount
        FROM per
        GROUP BY owner
        ORDER BY ${rankKey}, owner NULLS LAST
        LIMIT ${MAX_RANKED_EMPLOYEES + 1}
      )
      SELECT per.owner::text AS key, per.currency_code, per.status_code, per.count, per.amount
      FROM per
      JOIN ranked ON ranked.owner IS NOT DISTINCT FROM per.owner`);

    // 2. Teams — company TEAM (managed teams) / ALL (every active team).
    const teamWhere = this.teamWhere(scope);
    const teamFilterSql = this.teamFilterSql(scope);
    const teamsQuery = teamWhere
      ? Promise.all([
          this.prisma.salesTeam.findMany({
            where: teamWhere,
            orderBy: { name: 'asc' },
            take: MAX_TEAMS,
            select: {
              id: true,
              name: true,
              managerId: true,
              manager: { select: { fullName: true } },
              members: {
                select: { userId: true, user: { select: { fullName: true } } },
              },
            },
          }),
          this.prisma.$queryRaw<GroupedRow[]>(Prisma.sql`
            WITH team_people AS (
              SELECT t.id AS team_id, m.user_id
              FROM sales_teams t
              JOIN sales_team_members m ON m.sales_team_id = t.id
              WHERE ${teamFilterSql as Prisma.Sql}
              UNION
              SELECT t.id AS team_id, t.manager_id AS user_id
              FROM sales_teams t
              WHERE ${teamFilterSql as Prisma.Sql}
            )
            SELECT tp.team_id::text AS key, c.code AS currency_code,
                   ${ORDER_STATUS_CODE_SQL} AS status_code,
                   COUNT(*)::int AS count, SUM(${ORDER_AMOUNT_SQL}) AS amount
            ${fromOrders}
            JOIN team_people tp ON tp.user_id = o.employee_id
            WHERE ${window} AND ${filter}
            GROUP BY 1, 2, 3`),
        ])
      : Promise.resolve(null);

    // 3. Agents row — ALL scope only, a separate figure (never employees).
    const showAgents = scope.audience === 'company' && scope.label === 'ALL';
    const agentsQuery = showAgents
      ? this.prisma.$queryRaw<GroupedRow[]>(Prisma.sql`
          SELECT NULL::text AS key, c.code AS currency_code,
                 ${ORDER_STATUS_CODE_SQL} AS status_code,
                 COUNT(*)::int AS count, SUM(${ORDER_AMOUNT_SQL}) AS amount
          ${fromOrders}
          WHERE ${window} AND o.agent_id IS NOT NULL
          GROUP BY 2, 3`)
      : Promise.resolve(null);

    // 4. Payment mix — valid orders by payment type × currency.
    const mixQuery = this.prisma.$queryRaw<
      Array<{
        payment_type: string;
        currency_code: string;
        count: number;
        amount: Prisma.Decimal | string | null;
      }>
    >(Prisma.sql`
      SELECT o.payment_type::text AS payment_type, c.code AS currency_code,
             COUNT(*)::int AS count, SUM(${ORDER_AMOUNT_SQL}) AS amount
      ${fromOrders}
      WHERE ${window} AND ${filter}
        AND ${ORDER_STATUS_CODE_SQL} <> ${cancelled}
      GROUP BY 1, 2`);

    const [employeeRows, teamsResult, agentRows, mixRows] = await Promise.all([
      employeesQuery,
      teamsQuery,
      agentsQuery,
      mixQuery,
    ]);

    // Employees.
    const byOwner = new Map<string | null, SalesTally>();
    for (const row of employeeRows) {
      const tally = byOwner.get(row.key) ?? new SalesTally();
      tally.add({
        statusCode: row.status_code,
        currencyCode: row.currency_code,
        count: row.count,
        amount: row.amount,
      });
      byOwner.set(row.key, tally);
    }
    const ownerIds = [...byOwner.keys()].filter(
      (id): id is string => id !== null,
    );
    const users = ownerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameOf = new Map(users.map((user) => [user.id, user.fullName]));
    const rankedEmployees = rankEntries(
      [...byOwner.entries()].map(([userId, tally]) => ({
        userId,
        name: userId ? (nameOf.get(userId) ?? '') : '',
        tally,
      })),
      rankBy,
      currency,
    );
    const employees: RankedEmployee[] = rankedEmployees
      .slice(0, MAX_RANKED_EMPLOYEES)
      .map((entry) => ({
        rank: entry.rank,
        rankValue: entry.rankValue,
        userId: entry.userId,
        name: entry.userId ? entry.name : null,
        ...entry.tally.stats(),
      }));

    // Teams.
    let teams: RankedTeam[] | null = null;
    if (teamsResult) {
      const [teamRows, teamGroups] = teamsResult;
      const byTeam = new Map<string, SalesTally>(
        teamRows.map((team) => [team.id, new SalesTally()]),
      );
      for (const row of teamGroups) {
        if (!row.key) continue;
        byTeam.get(row.key)?.add({
          statusCode: row.status_code,
          currencyCode: row.currency_code,
          count: row.count,
          amount: row.amount,
        });
      }
      teams = rankEntries(
        teamRows.map((team) => ({
          team,
          name: team.name,
          tally: byTeam.get(team.id) as SalesTally,
        })),
        rankBy,
        currency,
      ).map((entry) => ({
        rank: entry.rank,
        rankValue: entry.rankValue,
        teamId: entry.team.id,
        name: entry.team.name,
        manager: {
          userId: entry.team.managerId,
          name: entry.team.manager.fullName,
        },
        members: entry.team.members
          .filter((member) => member.userId !== entry.team.managerId)
          .map((member) => ({
            userId: member.userId,
            name: member.user.fullName,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        ...entry.tally.stats(),
      }));
    }

    // Agents row.
    let agents: SalesStats | null = null;
    if (agentRows) {
      const tally = new SalesTally();
      for (const row of agentRows) {
        tally.add({
          statusCode: row.status_code,
          currencyCode: row.currency_code,
          count: row.count,
          amount: row.amount,
        });
      }
      agents = tally.stats();
    }

    // Payment mix.
    const mix = new Map<
      string,
      {
        prepaid: { count: number; amount: Prisma.Decimal };
        cod: { count: number; amount: Prisma.Decimal };
      }
    >();
    for (const row of mixRows) {
      const entry = mix.get(row.currency_code) ?? {
        prepaid: { count: 0, amount: new Prisma.Decimal(0) },
        cod: { count: 0, amount: new Prisma.Decimal(0) },
      };
      const side = row.payment_type === 'PREPAID' ? entry.prepaid : entry.cod;
      side.count += Number(row.count);
      side.amount = side.amount.add(new Prisma.Decimal(row.amount ?? 0));
      mix.set(row.currency_code, entry);
    }
    const paymentMix: PaymentMixRow[] = [...mix.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currencyCode, entry]) => ({
        currencyCode,
        prepaid: {
          count: entry.prepaid.count,
          amount: roundAmount(entry.prepaid.amount),
        },
        cod: { count: entry.cod.count, amount: roundAmount(entry.cod.amount) },
      }));

    return {
      scope: scope.label,
      timeZone: BUSINESS_TIME_ZONE,
      generatedAt: now.toISOString(),
      from: range.from,
      to: range.to,
      rankBy,
      currency,
      currencies: paymentMix.map((row) => row.currencyCode),
      employees,
      employeesTruncated: rankedEmployees.length > MAX_RANKED_EMPLOYEES,
      teams,
      agents,
      paymentMix,
    };
  }

  private teamWhere(scope: ReportScope): Prisma.SalesTeamWhereInput | null {
    if (scope.audience !== 'company') return null;
    if (scope.label === 'ALL') return { deletedAt: null, isActive: true };
    if (scope.label === 'TEAM') {
      return { deletedAt: null, isActive: true, managerId: scope.userId };
    }
    return null;
  }

  private teamFilterSql(scope: ReportScope): Prisma.Sql | null {
    if (scope.audience !== 'company') return null;
    if (scope.label === 'ALL') {
      return Prisma.sql`t.deleted_at IS NULL AND t.is_active = true`;
    }
    if (scope.label === 'TEAM') {
      return Prisma.sql`t.deleted_at IS NULL AND t.is_active = true AND t.manager_id = ${scope.userId}::uuid`;
    }
    return null;
  }
}
