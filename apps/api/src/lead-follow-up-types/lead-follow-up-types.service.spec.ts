import { BadRequestException } from '@nestjs/common';
import { LeadFollowUpTypesService } from './lead-follow-up-types.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Section K — "inactive Type handled safely": a Lead Follow-up may
 * historically reference an archived/inactive Lead Follow-up Type (never
 * rewritten), but new assignment must only ever accept an active,
 * non-deleted row — the same `assertAssignable` contract NoPurchaseReason
 * already uses.
 */
describe('LeadFollowUpTypesService.assertAssignable', () => {
  function makeService(row: Record<string, unknown> | null) {
    const findFirst = jest.fn().mockResolvedValue(row);
    const prisma = { leadFollowUpType: { findFirst } };
    const service = new LeadFollowUpTypesService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
    );
    return service;
  }

  it('accepts an active, non-deleted type', async () => {
    const service = makeService({
      id: 'type-1',
      isActive: true,
      deletedAt: null,
    });
    await expect(service.assertAssignable('type-1')).resolves.toMatchObject({
      id: 'type-1',
    });
  });

  it('rejects an inactive type', async () => {
    const service = makeService({
      id: 'type-1',
      isActive: false,
      deletedAt: null,
    });
    await expect(service.assertAssignable('type-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an archived (soft-deleted) type', async () => {
    const service = makeService({
      id: 'type-1',
      isActive: true,
      deletedAt: new Date(),
    });
    await expect(service.assertAssignable('type-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a non-existent type id', async () => {
    const service = makeService(null);
    await expect(service.assertAssignable('missing')).rejects.toThrow(
      BadRequestException,
    );
  });
});
