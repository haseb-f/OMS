import { ForbiddenException } from '@nestjs/common';
import { LeadAssignmentMethod } from '@prisma/client';
import { LeadsService } from './leads.service';
import {
  SalesScopeService,
  type SalesScope,
} from '../sales-scope/sales-scope.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Phase 4 — `bulkAssign` previously re-validated the (single, batch-wide)
 * target employee and re-fetched each Lead once per item, on top of
 * `LeadAssignmentsService.assign()`'s own per-item read/write. This covers
 * the batched behavior: one eligibility check + one prefetch query
 * regardless of batch size, while every per-item assignment/history/
 * scope-check call still happens once per lead.
 */
describe('LeadsService.bulkAssign', () => {
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
  };

  const teamScopeRestricted: SalesScope = {
    ...allScope,
    kind: 'TEAM',
    ownerIds: ['someone-else'],
  };

  function makeService(leadIds: string[]) {
    const prisma = {
      lead: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            leadIds.map((id) => ({ id, salesEmployeeId: null })),
          ),
      },
    };
    const leadAssignmentsService = {
      assertEligibleEmployee: jest.fn().mockResolvedValue(undefined),
      assign: jest.fn().mockResolvedValue({ id: 'assignment-1' }),
    };
    const service = new LeadsService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      leadAssignmentsService as never,
      {} as never,
      {} as never,
      {} as never,
      salesScope,
    );
    return { service, prisma, leadAssignmentsService };
  }

  it.each([1, 20, 100])(
    'assigns %d leads with exactly one eligibility check and one batch lead fetch',
    async (count) => {
      const ids = Array.from({ length: count }, (_, i) => `lead-${i}`);
      const { service, prisma, leadAssignmentsService } = makeService(ids);

      const result = await service.bulkAssign(
        { leadIds: ids, salesEmployeeId: 'emp-1', reason: 'rebalance' },
        'actor-1',
        allScope,
      );

      expect(result).toEqual({ assigned: count, ids });
      expect(
        leadAssignmentsService.assertEligibleEmployee,
      ).toHaveBeenCalledTimes(1);
      expect(
        leadAssignmentsService.assertEligibleEmployee,
      ).toHaveBeenCalledWith('emp-1');
      expect(prisma.lead.findMany).toHaveBeenCalledTimes(1);
      expect(leadAssignmentsService.assign).toHaveBeenCalledTimes(count);
      for (const id of ids) {
        expect(leadAssignmentsService.assign).toHaveBeenCalledWith(id, {
          salesEmployeeId: 'emp-1',
          method: LeadAssignmentMethod.MANUAL,
          reason: 'rebalance',
          actorId: 'actor-1',
          scope: allScope,
          skipEligibilityCheck: true,
        });
      }
    },
  );

  it('stops at the first ID not found among the prefetched leads (mixed valid/invalid IDs)', async () => {
    const { service, leadAssignmentsService } = makeService([
      'lead-1',
      'lead-2',
    ]);
    // lead-bad is requested but never returned by findMany — same as an
    // invalid/deleted id today.
    await expect(
      service.bulkAssign(
        { leadIds: ['lead-1', 'lead-bad', 'lead-2'], salesEmployeeId: 'emp-1' },
        'actor-1',
        allScope,
      ),
    ).rejects.toThrow('Lead not found');

    // lead-1 (processed before the bad id) was assigned; lead-2 (after) was not.
    expect(leadAssignmentsService.assign).toHaveBeenCalledTimes(1);
    expect(leadAssignmentsService.assign).toHaveBeenCalledWith(
      'lead-1',
      expect.objectContaining({ skipEligibilityCheck: true }),
    );
  });

  it('rejects an unauthorized target employee before touching the DB', async () => {
    const { service, prisma, leadAssignmentsService } = makeService(['lead-1']);

    await expect(
      service.bulkAssign(
        { leadIds: ['lead-1'], salesEmployeeId: 'emp-1' },
        'actor-1',
        teamScopeRestricted,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.lead.findMany).not.toHaveBeenCalled();
    expect(leadAssignmentsService.assign).not.toHaveBeenCalled();
  });
});
