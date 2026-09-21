import { Module } from '@nestjs/common';
import { FixedAssetsModule } from '../../fixed-assets/fixed-assets.module';
import { PrepaidExpensesModule } from '../../prepaid-expenses/prepaid-expenses.module';
import { AccountingSchedulesService } from './accounting-schedules.service';
import { AccountingSchedulesController } from './accounting-schedules.controller';
import { AccountingSchedulesCronController } from './accounting-schedules-cron.controller';

@Module({
  imports: [FixedAssetsModule, PrepaidExpensesModule],
  controllers: [
    AccountingSchedulesController,
    AccountingSchedulesCronController,
  ],
  providers: [AccountingSchedulesService],
})
export class AccountingSchedulesModule {}
