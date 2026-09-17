import { Module } from '@nestjs/common';
import { AccountingFoundationController } from './accounting-foundation.controller';
import { AccountingFoundationService } from './accounting-foundation.service';

@Module({
  controllers: [AccountingFoundationController],
  providers: [AccountingFoundationService],
  exports: [AccountingFoundationService],
})
export class AccountingFoundationModule {}
