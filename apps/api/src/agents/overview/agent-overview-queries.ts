import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  emptyLeadCounts,
  type LeadCounts,
  type TeamMember,
} from './agent-order-figures';

type LeadCountKey = 'agentId' | 'salesEmployeeId';

/** Lead statuses the overviews count on their own (catalog codes, `StatusDefinition.code`). */
const FRESH = 'NEW';
const CONVERTED = 'CONVERTED';

/**
 * Lead counts (all / new / converted) of the leads matching `where`, keyed
 * by agent or by sales employee: three grouped counts, whatever the number of
 * leads. Archived leads never count.
 */
export async function leadCountsBy(
  prisma: PrismaService,
  where: Prisma.LeadWhereInput,
  key: LeadCountKey,
): Promise<Map<string | null, LeadCounts>> {
  const group = (extra: Prisma.LeadWhereInput) =>
    prisma.lead.groupBy({
      by: ['agentId', 'salesEmployeeId'],
      where: { ...where, ...extra, deletedAt: null },
      _count: { _all: true },
    });
  const [all, fresh, converted] = await Promise.all([
    group({}),
    group({ status: { code: FRESH } }),
    group({ status: { code: CONVERTED } }),
  ]);
  const counts = new Map<string | null, LeadCounts>();
  const add = (rows: typeof all, field: keyof LeadCounts) => {
    for (const row of rows) {
      const id = row[key];
      const entry = counts.get(id) ?? emptyLeadCounts();
      entry[field] += row._count._all;
      counts.set(id, entry);
    }
  };
  add(all, 'total');
  add(fresh, 'fresh');
  add(converted, 'converted');
  return counts;
}

/** Lead counts of one scope (an agent, or one employee's leads). */
export async function leadCounts(
  prisma: PrismaService,
  where: Prisma.LeadWhereInput,
): Promise<LeadCounts> {
  const count = (extra: Prisma.LeadWhereInput) =>
    prisma.lead.count({ where: { ...where, ...extra, deletedAt: null } });
  const [total, fresh, converted] = await Promise.all([
    count({}),
    count({ status: { code: FRESH } }),
    count({ status: { code: CONVERTED } }),
  ]);
  return { total, fresh, converted };
}

/** The users of one agent (active or not), for the per-employee breakdown. */
export function agentTeamMembers(
  prisma: PrismaService,
  agentId: string,
): Promise<TeamMember[]> {
  return prisma.user.findMany({
    where: { agentId, deletedAt: null },
    select: { id: true, fullName: true, isActive: true },
    orderBy: { fullName: 'asc' },
  });
}
