import { Module } from '@nestjs/common';
import { KpiEvaluationsController } from './kpi-evaluations.controller';
import { KpiEvaluationsService } from './kpi-evaluations.service';
import { KpiTemplatesModule } from '../kpi-templates/kpi-templates.module';
import { EmployeesModule } from '../employees/employees.module';
import { SalesTargetsModule } from '../sales-targets/sales-targets.module';

@Module({
  imports: [KpiTemplatesModule, EmployeesModule, SalesTargetsModule],
  controllers: [KpiEvaluationsController],
  providers: [KpiEvaluationsService],
  exports: [KpiEvaluationsService],
})
export class KpiEvaluationsModule {}
