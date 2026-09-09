import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { EmployeesModule } from '../employees/employees.module';
import { KpiEvaluationsModule } from '../kpi-evaluations/kpi-evaluations.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';

@Module({
  imports: [
    EmployeesModule,
    KpiEvaluationsModule,
    CommissionsModule,
    PostingEngineModule,
  ],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
