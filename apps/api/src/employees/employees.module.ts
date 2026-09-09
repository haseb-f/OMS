import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { PartnersModule } from '../partners/partners.module';
import { UsersModule } from '../users/users.module';
import { DepartmentsModule } from '../departments/departments.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { PayrollComponentsModule } from '../payroll-components/payroll-components.module';

@Module({
  imports: [
    PartnersModule,
    UsersModule,
    DepartmentsModule,
    MasterDataModule,
    PayrollComponentsModule,
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
