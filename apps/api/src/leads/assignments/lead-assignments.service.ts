import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LeadActivityService,
  LeadActivityType,
} from '../activities/lead-activity.service';
import { CreateLeadAssignmentDto } from './dto/create-lead-assignment.dto';

/**
 * Manual assignment only, for this phase. Automatic distribution is a
 * future capability — not implemented here (see LeadAutoDistributionService).
 *
 * "Active sales employee" = a User that exists and is not soft-deleted
 * (`deletedAt IS NULL`) — the workspace has no separate employee-type/role
 * convention, so this reuses the existing User soft-delete flag rather than
 * inventing a new one.
 */
@Injectable()
export class LeadAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadActivityService: LeadActivityService,
  ) {}

  async assign(leadId: string, dto: CreateLeadAssignmentDto) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
    });
    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} not found`);
    }

    const salesEmployee = await this.prisma.user.findFirst({
      where: { id: dto.salesEmployeeId, deletedAt: null },
    });
    if (!salesEmployee) {
      throw new BadRequestException(
        'Sales employee not found or is not active.',
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
