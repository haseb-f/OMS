import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CostComponentActivityService } from './cost-component-activity.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('cost-components/:costComponentId/activities')
@UseGuards(JwtAuthGuard)
export class CostComponentActivitiesController {
  constructor(private readonly activityService: CostComponentActivityService) {}

  @Get()
  findAll(@Param('costComponentId') costComponentId: string) {
    return this.activityService.findAllForComponent(costComponentId);
  }
}
