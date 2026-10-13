import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LeadActivityService,
  LeadActivityType,
} from '../activities/lead-activity.service';

export interface LeadOpenResult {
  leadId: string;
  /** True when the caller is the lead's current assignee and the open was recorded. */
  recorded: boolean;
  /** The current assignee's first open in the current assignment (null = «لم يُفتح»). */
  openedByAssigneeAt: Date | null;
}

/**
 * R20 — "the assigned employee opened this lead" (the «لم يُفتح» indicator).
 *
 * READ STATE ONLY: it never changes the lead's business status, follow-up
 * fields or `updatedAt`. Callers have already proved the caller may read the
 * lead (company sales scope / agent-portal visibility) and pass the boundary
 * the open belongs to: `agentId` null from the company screens, the caller's
 * own agent from the agent portal. An open counts only when the caller IS the
 * lead's current assignee inside that boundary — a manager, an administrator,
 * company staff on an agent lead or a previous assignee get `recorded: false`
 * and nothing is written. The row is locked for the check so it serializes
 * with `LeadAssignmentsService.assign` (which resets the flag on a new owner).
 */
@Injectable()
export class LeadAssigneeOpensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadActivityService: LeadActivityService,
  ) {}

  async record(
    leadId: string,
    userId: string,
    agentId: string | null,
  ): Promise<LeadOpenResult> {
    return this.prisma.$transaction(async (tx) => {
      const [lead] = await tx.$queryRaw<
        Array<{
          sales_employee_id: string | null;
          agent_id: string | null;
          opened_by_assignee_at: Date | null;
        }>
      >`
        SELECT sales_employee_id, agent_id, opened_by_assignee_at
        FROM leads
        WHERE id = ${leadId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `;
      if (
        !lead ||
        !userId ||
        lead.sales_employee_id !== userId ||
        lead.agent_id !== agentId
      ) {
        return {
          leadId,
          recorded: false,
          openedByAssigneeAt: lead?.opened_by_assignee_at ?? null,
        };
      }

      const now = new Date();
      await tx.leadAssigneeOpen.upsert({
        where: { leadId_userId: { leadId, userId } },
        create: { leadId, userId, firstOpenedAt: now, lastOpenedAt: now },
        update: { lastOpenedAt: now, openCount: { increment: 1 } },
      });
      if (lead.opened_by_assignee_at) {
        return {
          leadId,
          recorded: true,
          openedByAssigneeAt: lead.opened_by_assignee_at,
        };
      }

      // First open of this assignment. Raw SQL on purpose: an open is not an
      // edit of the lead, so Prisma's `updatedAt` must not move. The columns
      // are UTC `timestamp(3)` like every Prisma DateTime.
      const at = now.toISOString();
      await tx.$executeRaw`
        UPDATE leads
        SET opened_by_assignee_at = (${at}::timestamptz AT TIME ZONE 'UTC'),
            first_opened_at = COALESCE(
              first_opened_at, (${at}::timestamptz AT TIME ZONE 'UTC')
            )
        WHERE id = ${leadId}::uuid
      `;
      await this.leadActivityService.log(
        leadId,
        LeadActivityType.OPENED_BY_ASSIGNEE,
        'Lead opened by the assigned employee',
        { userId },
        tx,
      );
      return { leadId, recorded: true, openedByAssigneeAt: now };
    });
  }
}
