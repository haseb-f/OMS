import { Module } from '@nestjs/common';
import { AccountingReportsController } from './accounting-reports.controller';
import { AccountingReportsService } from './accounting-reports.service';
import { VoucherIntegrityService } from './voucher-integrity.service';
import { FxModule } from '../fx/fx.module';

@Module({
  imports: [FxModule],
  controllers: [AccountingReportsController],
  providers: [AccountingReportsService, VoucherIntegrityService],
  exports: [AccountingReportsService],
})
export class AccountingReportsModule {}
