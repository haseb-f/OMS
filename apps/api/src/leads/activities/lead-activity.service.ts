import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Fixed examples given by the business (Lead Created, Lead Assigned,
 * Follow-up Started, Marked Paid, Archived, Note Added) are not a closed
 * set — new entry types may be added later without a migration, since
 * `LeadActivity.type` is a plain string column, not an enum.
 */
export const LeadActivityType = {
  LEAD_CREATED: 'LEAD_CREATED',
  LEAD_ASSIGNED: 'LEAD_ASSIGNED',
  LEAD_STATUS_CHANGED: 'LEAD_STATUS_CHANGED',
  FOLLOW_UP_STARTED: 'FOLLOW_UP_STARTED',
  MARKED_PAID: 'MARKED_PAID',
  ARCHIVED: 'ARCHIVED',
  NOTE_ADDED: 'NOTE_ADDED',
} as const;

@Injectable()
export class LeadActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a timeline entry. Accepts an optional transaction client so
   * callers can log the activity atomically alongside the operation that
   * triggered it.
   */
  log(
    leadId: string,
    type: string,
    description: string,
    metadata?: Record<string, unknown>,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.leadActivity.create({
      data: {
        leadId,
        type,
        description,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  findAllForLead(leadId: string) {
    return this.prisma.leadActivity.findMany({
      where: { leadId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }
}
