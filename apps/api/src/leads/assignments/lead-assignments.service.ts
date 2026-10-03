import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadAssignmentMethod, Prisma } from '@prisma/client';
import { assertOwnerAffiliation } from '../../agents/common/agent-affiliation';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadEligibilityService } from '../distribution/lead-eligibility.service';
import {
  LeadActivityService,
  LeadActivityType,
} from '../activities/lead-activity.service';
import {
  SalesScopeService,
  type SalesScope,
} from '../../sales-scope/sales-scope.service';

export interface AssignLeadInput {
  salesEmployeeId: string;
  method: LeadAssignmentMethod;
  reason?: string | null;
  actorId?: string | null;
  /** Required for MANUAL/REASSIGNMENT HTTP paths — Agents are denied. */
  scope?: SalesScope;
  /**
   * Bulk-assign-only: the caller already ran `assertEligibleEmployee` once
   * for this exact `salesEmployeeId` before looping over many leads — set
   * only when the same target employee is being re-validated on every
   * item of a batch that hasn't changed since. Every other caller (single
   * assign, auto-distribution, import) omits this and keeps the per-call
   * check.
   */
  skipEligibilityCheck?: boolean;
}

/**
 * The one append-only assignment write path. Auto-distribution, manual
 * assign, import-explicit owner, and reassignment all call this.
 */
@Injectable()
export class LeadAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadActivityService: LeadActivityService,
    private readonly eligibility: LeadEligibilityService,
    private readonly salesScope: SalesScopeService,
  ) {}

  /**
   * R7 — the same shared rule set the automatic pool uses (sales-designated,
   * active, unlocked, employed, internal, `crm.leads.edit`), so a manual
   * assignment can never reach someone the distribution would exclude.
   */
  async assertEligibleEmployee(employeeId: string) {
    return this.eligibility.assertEligible(employeeId);
  }

  private async assertSameAffiliation(
    client: Prisma.TransactionClient,
    leadAgentId: string | null,
    targetUserId: string,
  ) {
    await assertOwnerAffiliation(client, leadAgentId, targetUserId, {
      agentScope: {
        code: 'AGENT_LEAD_ASSIGNMENT_SCOPE',
        message:
          'عميل الوكيل المحتمل يُسند فقط لمستخدم نشط من نفس الوكيل — An agent lead can only be assigned to an active user of the same agent.',
      },
      internalOnly: {
        code: 'AGENT_USER_NOT_ASSIGNABLE',
        message:
          'لا يمكن إسناد عميل محتمل للشركة إلى مستخدم وكيل — A company lead cannot be assigned to an agent user.',
      },
      notFound: 'Sales employee not found or is not active.',
    });
  }

  async assign(
    leadId: string,
    dto: AssignLeadInput,
    tx?: Prisma.TransactionClient,
  ) {
    const run = async (client: Prisma.TransactionClient) => {
      const lead = await client.lead.findFirst({
        where: { id: leadId, deletedAt: null },
      });
      if (!lead) {
        throw new NotFoundException(`Lead ${leadId} not found`);
      }

      // Agents milestone (spec §3/§6): an agent's lead stays inside that
      // agent's team and a company lead never goes to an agent user —
      // enforced on this single write path (manual, bulk, auto, import).
      await this.assertSameAffiliation(
        client,
        lead.agentId,
        dto.salesEmployeeId,
      );
      if (!dto.skipEligibilityCheck && !lead.agentId) {
        await this.assertEligibleEmployee(dto.salesEmployeeId);
      }

      const method =
        lead.salesEmployeeId &&
        lead.salesEmployeeId !== dto.salesEmployeeId &&
        dto.method === LeadAssignmentMethod.MANUAL
          ? LeadAssignmentMethod.REASSIGNMENT
          : dto.method;

      if (
        dto.scope &&
        (method === LeadAssignmentMethod.MANUAL ||
          method === LeadAssignmentMethod.REASSIGNMENT)
      ) {
        this.salesScope.assertCanAssign(dto.scope);
        if (!this.salesScope.canSetOrderOwner(dto.scope, dto.salesEmployeeId)) {
          throw new ForbiddenException(
            'Target employee is outside your assignment scope.',
          );
        }
      }

      const assignedAt = new Date();
      const assignment = await client.leadAssignment.create({
        data: {
          leadId,
          fromUserId: lead.salesEmployeeId,
          assignedToId: dto.salesEmployeeId,
          method,
          reason: dto.reason?.trim() || null,
          actorId: dto.actorId ?? null,
          assignedAt,
          createdBy: dto.actorId ?? null,
        },
      });
      await client.lead.update({
        where: { id: leadId },
        data: {
          salesEmployeeId: dto.salesEmployeeId,
          assignedAt,
          distributionHeld: false,
        },
      });
      await this.leadActivityService.log(
        leadId,
        LeadActivityType.LEAD_ASSIGNED,
        'Lead assigned to sales employee',
        {
          assignmentId: assignment.id,
          salesEmployeeId: dto.salesEmployeeId,
          method,
          fromUserId: lead.salesEmployeeId,
        },
        client,
      );
      return assignment;
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }

  findAllForLead(leadId: string) {
    return this.prisma.leadAssignment.findMany({
      where: { leadId, deletedAt: null },
      include: {
        assignedTo: { select: { id: true, fullName: true } },
        fromUser: { select: { id: true, fullName: true } },
        actor: { select: { id: true, fullName: true } },
      },
      orderBy: { assignedAt: 'asc' },
    });
  }
}
