import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { LeadActivityService } from './lead-activity.service';

/**
 * Read-only: activities are system-generated timeline entries, never
 * created directly by a client.
 */
@Controller('leads/:leadId/activities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('leads')
export class LeadActivitiesController {
  constructor(private readonly leadActivityService: LeadActivityService) {}

  @Get()
  findAll(@Param('leadId') leadId: string) {
    return this.leadActivityService.findAllForLead(leadId);
  }
}
