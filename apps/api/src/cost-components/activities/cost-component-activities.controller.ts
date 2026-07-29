import { Controller, Get, Param } from '@nestjs/common';
import { CostComponentActivityService } from './cost-component-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('cost-components/:costComponentId/activities')
export class CostComponentActivitiesController {
  constructor(private readonly activityService: CostComponentActivityService) {}

  @Get()
  findAll(@Param('costComponentId') costComponentId: string) {
    return this.activityService.findAllForComponent(costComponentId);
  }
}
