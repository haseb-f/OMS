import { Module } from '@nestjs/common';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';
import { CommissionPlansModule } from '../commission-plans/commission-plans.module';
import { SalesTargetsModule } from '../sales-targets/sales-targets.module';

@Module({
  imports: [CommissionPlansModule, SalesTargetsModule],
  controllers: [CommissionsController],
  providers: [CommissionsService],
  exports: [CommissionsService],
})
export class CommissionsModule {}
