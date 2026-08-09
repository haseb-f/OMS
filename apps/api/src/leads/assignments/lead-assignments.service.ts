import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import {
  LeadActivityService,
  LeadActivityType,
} from '../activities/lead-activity.service';
import { CreateLeadAssignmentDto } from './dto/create-lead-assignment.dto';

const ASSIGNABLE_PERMISSION = 'crm.leads.edit';

/**
 * The one append-only assignment write path — both manual assignment and
 * `LeadAutoDistributionService`'s auto/bulk distribution call this same
 * method, never a second one.
 *
 * "Active sales employee" = a User that exists, is not soft-deleted
 * (`deletedAt IS NULL`), `isActive`, not `isLocked`, and holds
 * `crm.leads.edit` (TASK-061 §5/§8 — "Never assign inactive users" /
 * "Never assign users without the required permission") — enforced here
 * rather than only in Auto Assignment, since a manager's manual pick must
 * satisfy the exact same rule.
 */
@Injectable()
export class LeadAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadActivityService: LeadActivityService,
    private readonly permissionsResolver: PermissionsResolverService,
  ) {}

  async assign(leadId: string, dto: CreateLeadAssignmentDto) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
    });
    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} not found`);
    }

    const salesEmployee = await this.prisma.user.findFirst({
      where: {
        id: dto.salesEmployeeId,
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
      dto.salesEmployeeId,
      ASSIGNABLE_PERMISSION,
    );
    if (!canHandleLeads) {
      throw new BadRequestException(
        'This employee does not have permission to handle Leads/Orders.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const assignedAt = new Date();
      const assignment = await tx.leadAssignment.create({
        data: { leadId, assignedToId: dto.salesEmployeeId, assignedAt },
      });
      await tx.lead.update({
        where: { id: leadId },
        data: { salesEmployeeId: dto.salesEmployeeId, assignedAt },
      });
      await this.leadActivityService.log(
        leadId,
        LeadActivityType.LEAD_ASSIGNED,
        'Lead assigned to sales employee',
        { assignmentId: assignment.id, salesEmployeeId: dto.salesEmployeeId },
        tx,
      );
      return assignment;
    });
  }

  findAllForLead(leadId: string) {
    return this.prisma.leadAssignment.findMany({
      where: { leadId, deletedAt: null },
      orderBy: { assignedAt: 'asc' },
    });
  }
}
