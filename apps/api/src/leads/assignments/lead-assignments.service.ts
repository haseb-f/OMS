import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadAssignmentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import {
  LeadActivityService,
  LeadActivityType,
} from '../activities/lead-activity.service';

const ASSIGNABLE_PERMISSION = 'crm.leads.edit';

export interface AssignLeadInput {
  salesEmployeeId: string;
  method: LeadAssignmentMethod;
  reason?: string | null;
  actorId?: string | null;
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
    private readonly permissionsResolver: PermissionsResolverService,
  ) {}

  async assertEligibleEmployee(employeeId: string) {
    const salesEmployee = await this.prisma.user.findFirst({
      where: {
        id: employeeId,
        deletedAt: null,
        isActive: true,
        isLocked: false,
      },
    });
    if (!salesEmployee) {
      throw new BadRequestException(
        'Sales employee not found or is not active.',
      );
    }
    const canHandleLeads = await this.permissionsResolver.hasPermission(
      employeeId,
      ASSIGNABLE_PERMISSION,
    );
    if (!canHandleLeads) {
      throw new BadRequestException(
        'This employee does not have permission to handle Leads/Orders.',
      );
    }
    return salesEmployee;
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

      await this.assertEligibleEmployee(dto.salesEmployeeId);

      const method =
        lead.salesEmployeeId &&
        lead.salesEmployeeId !== dto.salesEmployeeId &&
        dto.method === LeadAssignmentMethod.MANUAL
          ? LeadAssignmentMethod.REASSIGNMENT
          : dto.method;

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
        data: { salesEmployeeId: dto.salesEmployeeId, assignedAt },
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
