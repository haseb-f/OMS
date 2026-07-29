import { Module } from '@nestjs/common';
import { CostComponentsController } from './cost-components.controller';
import { CostComponentsService } from './cost-components.service';
import { CostComponentActivitiesController } from './activities/cost-component-activities.controller';
import { CostComponentActivityService } from './activities/cost-component-activity.service';

@Module({
  controllers: [CostComponentsController, CostComponentActivitiesController],
  providers: [CostComponentsService, CostComponentActivityService],
})
export class CostComponentsModule {}
