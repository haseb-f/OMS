import { Module } from '@nestjs/common';
import { PayrollComponentsController } from './payroll-components.controller';
import { PayrollComponentsService } from './payroll-components.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [MasterDataModule],
  controllers: [PayrollComponentsController],
  providers: [PayrollComponentsService],
  exports: [PayrollComponentsService],
})
export class PayrollComponentsModule {}
