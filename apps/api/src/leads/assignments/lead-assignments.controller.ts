import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { LeadAssignmentsService } from './lead-assignments.service';
import { CreateLeadAssignmentDto } from './dto/create-lead-assignment.dto';

/**
 * Append-only: reassigning a lead creates a new assignment record rather
 * than editing history, so there is no update/delete here. Guarded the same
 * as `LeadsController`'s own `:id/assign` (TASK-061) — this is the other
 * route to the same `LeadAssignmentsService.assign()`, so it needs the same
 * `crm.leads.manage` requirement or it would bypass it.
 */
@Controller('leads/:leadId/assignments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('leads')
export class LeadAssignmentsController {
  constructor(
    private readonly leadAssignmentsService: LeadAssignmentsService,
  ) {}

  @Post()
  @PermissionAction('manage')
  assign(
    @Param('leadId') leadId: string,
    @Body() dto: CreateLeadAssignmentDto,
  ) {
    return this.leadAssignmentsService.assign(leadId, dto);
  }

  @Get()
  findAll(@Param('leadId') leadId: string) {
    return this.leadAssignmentsService.findAllForLead(leadId);
  }
}
