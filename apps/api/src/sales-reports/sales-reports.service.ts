import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SalesScopeService } from '../sales-scope/sales-scope.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import type { AgentRequestContext } from '../auth/guards/jwt-auth.guard';
import { resolveAgentReportScope } from '../agents/common/agent-visibility';
import type {
  AgentReportScope,
  CompanyReportScope,
  ReportScope,
} from '../sales-scope/sales-report-scope';
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
  type PeriodRange,
  type RankBy,
  type SalesStats,
} from './sales-metrics';
import type { SalesPerformanceQueryDto } from './dto/sales-performance-query.dto';

/** Upper bound of ranked employees per response (single grouped query). */
export const MAX_RANKED_EMPLOYEES = 200;
/** Upper bound of teams per response. */
export const MAX_TEAMS = 100;

export type SalesReportScopeLabel = ReportScope['label'];

/** OWN / AGENT_OWN: the caller's own figures only, with their own rank. */
export function isOwnScope(scope: ReportScope): boolean {
  return scope.label === 'OWN' || scope.label === 'AGENT_OWN';
}

/**
 * The caller's own standing (R15 6.1): competition rank over the whole
 * company (company users) or the whole agent (agent users) by the report's
 * rank key, among employees with orders in the period. Position and count
 * only — never another employee's name or figure.
 */
export interface OwnRank {
  /** null when the caller has no orders in the period (not ranked). */
  position: number | null;
  /** Ranked employees in that population. */
  of: number;
}

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
  userId: string;
  name: string;
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
  /**
   * TEAM / ALL / AGENT_ALL: the employees in scope, ranked among themselves.
   * OWN / AGENT_OWN: the caller's own row, its rank = `ownRank.position`.
   */
  employees: RankedEmployee[];
  employeesTruncated: boolean;
  ownRank: OwnRank;
  /** null when the viewer's scope has no team view (OWN / agent portal). */
  teams: RankedTeam[] | null;
  /** Agent orders as one separate row — ALL scope only, never mixed in. */
  agents: SalesStats | null;
  /** Company orders without an owner — ALL scope only, never ranked. */
  unassigned: SalesStats | null;
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

/** Live orders placed in the range (alias `o`), by `orderDate`. */
function windowSql(range: PeriodRange): Prisma.Sql {
  return Prisma.sql`o.deleted_at IS NULL AND o.order_date >= ${ts(range.start)} AND o.order_date < ${ts(range.endExclusive)}`;
}

const FROM_ORDERS = Prisma.sql`
  FROM store_orders o
  JOIN currencies c ON c.id = o.currency_id
  LEFT JOIN status_definitions sd ON sd.id = o.fulfillment_status_id`;

function addRow(tally: SalesTally, row: GroupedRow): void {
  tally.add({
    statusCode: row.status_code,
    currencyCode: row.currency_code,
    count: row.count,
    amount: row.amount,
  });
}

@Injectable()
export class SalesReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesScope: SalesScopeService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  // -------------------------------------------------------------------------
  // Scope — the ONE report-scope resolver for every sales figure surface
  // -------------------------------------------------------------------------

  companyScope(userId: string): Promise<CompanyReportScope> {
    return this.salesScope.resolveReportScope(userId);
  }

  async agentScope(agent: AgentRequestContext): Promise<AgentReportScope> {
    const visibility = await resolveAgentReportScope(agent, this.permissions);
    return {
      audience: 'agent',
      label: visibility.ownerUserId ? 'AGENT_OWN' : 'AGENT_ALL',
      userId: visibility.userId,
      agentId: visibility.agentId,
      ownerUserId: visibility.ownerUserId,
    };
  }

  /** The order set the figures cover (alias `o`). */
  private orderFilter(scope: ReportScope): Prisma.Sql {
    if (scope.audience === 'agent') {
      return scope.ownerUserId
        ? Prisma.sql`o.agent_id = ${scope.agentId}::uuid AND o.employee_id = ${scope.ownerUserId}::uuid`
        : Prisma.sql`o.agent_id = ${scope.agentId}::uuid`;
    }
    if (!scope.ownerIds) return Prisma.sql`o.agent_id IS NULL`;
    return Prisma.sql`o.agent_id IS NULL AND o.employee_id IN (${uuidList(scope.ownerIds)})`;
  }

  /** Who an own rank is computed over: every owner of the company / the agent. */
  private rankPopulation(scope: ReportScope): Prisma.Sql {
    return scope.audience === 'agent'
      ? Prisma.sql`o.agent_id = ${scope.agentId}::uuid AND o.employee_id IS NOT NULL`
      : Prisma.sql`o.agent_id IS NULL AND o.employee_id IS NOT NULL`;
  }

  // -------------------------------------------------------------------------
  // Period tallies (Live cards, dashboard figures)
  // -------------------------------------------------------------------------

  /**
   * ONE grouped query for any number of ranges: each order joins every range
   * it falls in (today ⊂ last 7 days ⊂ …), grouped by range × currency × status.
   */
  private async tallies<K extends string>(
    scope: ReportScope,
    ranges: Array<PeriodRange & { key: K }>,
  ): Promise<Map<K, SalesTally>> {
    const result = new Map<K, SalesTally>(
      ranges.map((range) => [range.key, new SalesTally()]),
    );
    const minStart = new Date(
      Math.min(...ranges.map((range) => range.start.getTime())),
    );
    const maxEnd = new Date(
      Math.max(...ranges.map((range) => range.endExclusive.getTime())),
    );
    const values = Prisma.join(
      ranges.map(
        (range) =>
          Prisma.sql`(${range.key}::text, ${ts(range.start)}, ${ts(range.endExclusive)})`,
      ),
    );
    const rows = await this.prisma.$queryRaw<GroupedRow[]>(Prisma.sql`
      SELECT p.key AS key, c.code AS currency_code,
             ${ORDER_STATUS_CODE_SQL} AS status_code,
             COUNT(*)::int AS count, SUM(${ORDER_AMOUNT_SQL}) AS amount
      FROM store_orders o
      JOIN (VALUES ${values}) AS p(key, start_at, end_at)
        ON o.order_date >= p.start_at AND o.order_date < p.end_at
      JOIN currencies c ON c.id = o.currency_id
      LEFT JOIN status_definitions sd ON sd.id = o.fulfillment_status_id
      WHERE o.deleted_at IS NULL
        AND o.order_date >= ${ts(minStart)} AND o.order_date < ${ts(maxEnd)}
        AND ${this.orderFilter(scope)}
      GROUP BY 1, 2, 3`);
    for (const row of rows) {
      const tally = result.get(row.key as K);
      if (tally) addRow(tally, row);
    }
    return result;
  }

  /** Orders in scope placed in one range (the dashboard's figures). */
  async periodTally(
    scope: ReportScope,
    range: PeriodRange,
  ): Promise<SalesTally> {
    const tallies = await this.tallies(scope, [{ ...range, key: 'period' }]);
    return tallies.get('period') as SalesTally;
  }

  // -------------------------------------------------------------------------
  // Live
  // -------------------------------------------------------------------------

  async live(scope: ReportScope, now: Date = new Date()): Promise<LiveReport> {
    const ranges = livePeriodRanges(now);
    const tallies = await this.tallies(
      scope,
      ranges.map((range) => ({ ...range, key: range.period })),
    );
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
  // Ranking
  // -------------------------------------------------------------------------

  /**
   * Employees in scope ranked among themselves (`rankEntries`), bounded to
   * the top N owners by the same rank key (N + 1 fetched to report
   * truncation). Orders without an owner are never ranked.
   */
  async employeeRanking(
    scope: ReportScope,
    range: PeriodRange,
    rankBy: RankBy,
    currency: string | null,
  ): Promise<{ employees: RankedEmployee[]; truncated: boolean }> {
    const cancelled = CANCELLED_STATUS;
    const rankKey =
      rankBy === 'amount'
        ? Prisma.sql`rank_amount DESC, valid DESC`
        : Prisma.sql`valid DESC`;
    const rows = await this.prisma.$queryRaw<GroupedRow[]>(Prisma.sql`
      WITH per AS (
        SELECT o.employee_id AS owner, c.code AS currency_code,
               ${ORDER_STATUS_CODE_SQL} AS status_code,
               COUNT(*)::int AS count, SUM(${ORDER_AMOUNT_SQL}) AS amount
        ${FROM_ORDERS}
        WHERE ${windowSql(range)} AND ${this.orderFilter(scope)}
          AND o.employee_id IS NOT NULL
        GROUP BY 1, 2, 3
      ), ranked AS (
        SELECT owner,
               COALESCE(SUM(count) FILTER (WHERE status_code <> ${cancelled}), 0) AS valid,
               COALESCE(SUM(amount) FILTER (WHERE status_code <> ${cancelled} AND currency_code = ${currency ?? ''}), 0) AS rank_amount
        FROM per
        GROUP BY owner
        ORDER BY ${rankKey}, owner
        LIMIT ${MAX_RANKED_EMPLOYEES + 1}
      )
      SELECT per.owner::text AS key, per.currency_code, per.status_code, per.count, per.amount
      FROM per
      JOIN ranked ON ranked.owner = per.owner`);

    const byOwner = new Map<string, SalesTally>();
    for (const row of rows) {
      const owner = row.key as string;
      const tally = byOwner.get(owner) ?? new SalesTally();
      addRow(tally, row);
      byOwner.set(owner, tally);
    }
    const users = byOwner.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...byOwner.keys()] } },
          select: { id: true, fullName: true },
        })
      : [];
    const nameOf = new Map(users.map((user) => [user.id, user.fullName]));
    const ranked = rankEntries(
      [...byOwner.entries()].map(([userId, tally]) => ({
        userId,
        name: nameOf.get(userId) ?? '',
        tally,
      })),
      rankBy,
      currency,
    );
    return {
      employees: ranked.slice(0, MAX_RANKED_EMPLOYEES).map((entry) => ({
        rank: entry.rank,
        rankValue: entry.rankValue,
        userId: entry.userId,
        name: entry.name,
        ...entry.tally.stats(),
      })),
      truncated: ranked.length > MAX_RANKED_EMPLOYEES,
    };
  }

  /**
   * The caller's own standing over the whole population (company or agent):
   * the SQL twin of `rankEntries`' competition rank on the primary key —
   * 1 + the number of owners strictly ahead. Returns the caller's own valid
   * count too; nothing about anyone else leaves the query but the count.
   */
  async ownStanding(
    scope: ReportScope,
    range: PeriodRange,
    rankBy: RankBy,
    currency: string | null,
  ): Promise<OwnRank & { valid: number }> {
    const cancelled = CANCELLED_STATUS;
    const ahead =
      rankBy === 'amount'
        ? Prisma.sql`per.rank_amount > me.rank_amount`
        : Prisma.sql`per.valid > me.valid`;
    const [row] = await this.prisma.$queryRaw<
      Array<{ of: number; ahead: number; ranked: boolean; valid: number }>
    >(Prisma.sql`
      WITH per AS (
        SELECT o.employee_id AS owner,
               COUNT(*) FILTER (WHERE ${ORDER_STATUS_CODE_SQL} <> ${cancelled}) AS valid,
               COALESCE(SUM(${ORDER_AMOUNT_SQL}) FILTER (WHERE ${ORDER_STATUS_CODE_SQL} <> ${cancelled} AND c.code = ${currency ?? ''}), 0) AS rank_amount
        ${FROM_ORDERS}
        WHERE ${windowSql(range)} AND ${this.rankPopulation(scope)}
        GROUP BY 1
      ), me AS (
        SELECT valid, rank_amount FROM per WHERE owner = ${scope.userId}::uuid
      )
      SELECT (SELECT COUNT(*) FROM per)::int AS of,
             (SELECT COUNT(*) FROM per, me WHERE ${ahead})::int AS ahead,
             EXISTS (SELECT 1 FROM me) AS ranked,
             COALESCE((SELECT valid FROM me), 0)::int AS valid`);
    return {
      position: row.ranked ? row.ahead + 1 : null,
      of: row.of,
      valid: row.valid,
    };
  }

  // -------------------------------------------------------------------------
  // Performance (employees, own rank, teams, agents / unassigned rows, mix)
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
    const window = windowSql(range);
    const cancelled = CANCELLED_STATUS;

    // Teams — company TEAM (managed teams) / ALL (every active team).
    const teamWhere = this.teamWhere(scope);
    const teamFilterSql = this.teamFilterSql(scope);
    const teamsQuery =
      teamWhere && teamFilterSql
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
                  select: {
                    userId: true,
                    user: { select: { fullName: true } },
                  },
                },
              },
            }),
            this.prisma.$queryRaw<GroupedRow[]>(Prisma.sql`
              WITH team_people AS (
                SELECT t.id AS team_id, m.user_id
                FROM sales_teams t
                JOIN sales_team_members m ON m.sales_team_id = t.id
                WHERE ${teamFilterSql}
                UNION
                SELECT t.id AS team_id, t.manager_id AS user_id
                FROM sales_teams t
                WHERE ${teamFilterSql}
              )
              SELECT tp.team_id::text AS key, c.code AS currency_code,
                     ${ORDER_STATUS_CODE_SQL} AS status_code,
                     COUNT(*)::int AS count, SUM(${ORDER_AMOUNT_SQL}) AS amount
              ${FROM_ORDERS}
              JOIN team_people tp ON tp.user_id = o.employee_id
              WHERE ${window} AND ${filter}
              GROUP BY 1, 2, 3`),
          ])
        : Promise.resolve(null);

    // Agents / unassigned rows — company ALL only, separate figures.
    const showAll = scope.audience === 'company' && scope.label === 'ALL';
    const separateQuery = showAll
      ? this.prisma.$queryRaw<GroupedRow[]>(Prisma.sql`
          SELECT CASE WHEN o.agent_id IS NULL THEN 'unassigned' ELSE 'agents' END AS key,
                 c.code AS currency_code,
                 ${ORDER_STATUS_CODE_SQL} AS status_code,
                 COUNT(*)::int AS count, SUM(${ORDER_AMOUNT_SQL}) AS amount
          ${FROM_ORDERS}
          WHERE ${window} AND (o.agent_id IS NOT NULL OR o.employee_id IS NULL)
          GROUP BY 1, 2, 3`)
      : Promise.resolve(null);

    // Payment mix — valid orders by payment type × currency.
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
      ${FROM_ORDERS}
      WHERE ${window} AND ${filter}
        AND ${ORDER_STATUS_CODE_SQL} <> ${cancelled}
      GROUP BY 1, 2`);

    const [ranking, standing, teamsResult, separateRows, mixRows] =
      await Promise.all([
        this.employeeRanking(scope, range, rankBy, currency),
        this.ownStanding(scope, range, rankBy, currency),
        teamsQuery,
        separateQuery,
        mixQuery,
      ]);
    const ownRank: OwnRank = { position: standing.position, of: standing.of };

    // In an own scope the only row is the caller's: its rank is their
    // position over the whole company / agent, never "1 of 1".
    const employees = isOwnScope(scope)
      ? ranking.employees.map((row) => ({
          ...row,
          rank: ownRank.position ?? row.rank,
        }))
      : ranking.employees;

    // Teams.
    let teams: RankedTeam[] | null = null;
    if (teamsResult) {
      const [teamRows, teamGroups] = teamsResult;
      const byTeam = new Map<string, SalesTally>(
        teamRows.map((team) => [team.id, new SalesTally()]),
      );
      for (const row of teamGroups) {
        const tally = row.key ? byTeam.get(row.key) : undefined;
        if (tally) addRow(tally, row);
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

    // Agents / unassigned rows.
    let agents: SalesStats | null = null;
    let unassigned: SalesStats | null = null;
    if (separateRows) {
      const agentTally = new SalesTally();
      const unassignedTally = new SalesTally();
      for (const row of separateRows) {
        addRow(row.key === 'agents' ? agentTally : unassignedTally, row);
      }
      agents = agentTally.stats();
      unassigned = unassignedTally.stats();
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
      employeesTruncated: ranking.truncated,
      ownRank,
      teams,
      agents,
      unassigned,
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
