import { LeadsService } from './leads.service';
import {
  SalesScopeService,
  type SalesScope,
} from '../sales-scope/sales-scope.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { FindLeadsQueryDto } from './dto/find-leads-query.dto';

/**
 * Regression coverage for `LeadsService.buildLeadWhere()` — the private
 * where-builder exercised here indirectly through `findAll()`. Covers two
 * requirements from the "Additional OMS UX + Leads Governance" spec:
 *
 * - Section C1: Lead Classification (`classificationIds`) is a plain
 *   independent AND filter, never coupled to status/lifecycle filtering.
 * - Section E6: the "Next Follow-up" quick filter (today/overdue/upcoming/
 *   none) is bucketed over the denormalized `nextFollowUpAt` the same way
 *   the table cell buckets it (lead-columns.tsx) — "today" wins even once
 *   its time-of-day has passed, so "overdue" means strictly before today.
 */
describe('LeadsService list filters', () => {
  const salesScope = new SalesScopeService(
    {} as unknown as PrismaService,
    {} as never,
  );

  const allScope: SalesScope = {
    kind: 'ALL',
    ownerIds: null,
    userId: 'actor-1',
    isSuperAdmin: false,
    canManageLeads: true,
    canViewLeads: true,
    canViewStoreOrders: true,
    canViewShipping: true,
    canEditShipping: true,
    canViewPaymentEvidence: true,
    canManagePaymentEvidence: true,
  };

  function makeService() {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { lead: { findMany, count } };
    const service = new LeadsService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      salesScope,
      {} as never,
    );
    return { service, findMany };
  }

  async function whereFor(query: Partial<FindLeadsQueryDto>) {
    const { service, findMany } = makeService();
    await service.findAll(query, allScope);
    const call = findMany.mock.calls[0] as [{ where: unknown }];
    return call[0].where as { AND: Record<string, unknown>[] };
  }

  it('AND-composes classificationIds independently of lifecycle/status filters', async () => {
    const where = await whereFor({
      classificationIds: ['class-1', 'class-2'],
      lifecycle: 'active',
    });
    expect(where.AND).toContainEqual({
      customerClassificationId: { in: ['class-1', 'class-2'] },
    });
    expect(where.AND).toContainEqual({
      status: { code: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] } },
    });
  });

  it('omits the classification clause entirely when no classification filter is set', async () => {
    const where = await whereFor({});
    const hasClassificationClause = where.AND.some(
      (part) => 'customerClassificationId' in part,
    );
    expect(hasClassificationClause).toBe(false);
  });

  it('followUpFilter=today matches the [startOfDay, startOfTomorrow) bucket', async () => {
    const where = await whereFor({ followUpFilter: 'today' });
    const clause = where.AND.find((part) => 'nextFollowUpAt' in part) as {
      nextFollowUpAt: { gte: Date; lt: Date };
    };
    expect(clause.nextFollowUpAt.gte.getHours()).toBe(0);
    expect(
      clause.nextFollowUpAt.lt.getTime() - clause.nextFollowUpAt.gte.getTime(),
    ).toBe(24 * 60 * 60 * 1000);
  });

  it('followUpFilter=overdue is strictly before the start of today (matches table cell bucketing)', async () => {
    const where = await whereFor({ followUpFilter: 'overdue' });
    const clause = where.AND.find((part) => 'nextFollowUpAt' in part) as {
      nextFollowUpAt: { lt: Date };
    };
    const startOfToday = clause.nextFollowUpAt.lt;
    expect(startOfToday.getHours()).toBe(0);
    expect(startOfToday.getMinutes()).toBe(0);
  });

  it('followUpFilter=none matches leads with no next follow-up at all', async () => {
    const where = await whereFor({ followUpFilter: 'none' });
    expect(where.AND).toContainEqual({ nextFollowUpAt: null });
  });

  it('omits any nextFollowUpAt clause when no follow-up filter is set', async () => {
    const where = await whereFor({});
    const hasFollowUpClause = where.AND.some(
      (part) => 'nextFollowUpAt' in part,
    );
    expect(hasFollowUpClause).toBe(false);
  });
});
