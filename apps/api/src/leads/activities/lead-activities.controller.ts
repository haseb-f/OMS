import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { LeadActivityService } from './lead-activity.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import { LeadsService } from '../leads.service';

@Controller('leads/:leadId/activities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('leads')
export class LeadActivitiesController {
  constructor(
    private readonly leadActivityService: LeadActivityService,
    private readonly leadsService: LeadsService,
    private readonly salesScope: SalesScopeService,
  ) {}

  @Get()
  async findAll(
    @Param('leadId') leadId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    await this.leadsService.findOne(leadId, scope);
    return this.leadActivityService.findAllForLead(leadId);
  }
}
