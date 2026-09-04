import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { LeadAssignmentsService } from './lead-assignments.service';
import { CreateLeadAssignmentDto } from './dto/create-lead-assignment.dto';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import { LeadsService } from '../leads.service';
import { LeadAssignmentMethod } from '@prisma/client';

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
    private readonly leadsService: LeadsService,
    private readonly salesScope: SalesScopeService,
  ) {}

  @Post()
  @PermissionAction('edit')
  async assign(
    @Param('leadId') leadId: string,
    @Body() dto: CreateLeadAssignmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    this.salesScope.assertCanAssign(scope);
    await this.leadsService.findOne(leadId, scope);
    return this.leadAssignmentsService.assign(leadId, {
      salesEmployeeId: dto.salesEmployeeId,
      method: LeadAssignmentMethod.MANUAL,
      reason: dto.reason,
      actorId: user.sub,
      scope,
    });
  }

  @Get()
  async findAll(
    @Param('leadId') leadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    await this.leadsService.findOne(leadId, scope);
    return this.leadAssignmentsService.findAllForLead(leadId);
  }
}
