import { Module } from '@nestjs/common';
import { SalesScopeModule } from '../sales-scope/sales-scope.module';
import { CustomerLookupController } from './customer-lookup.controller';
import { CustomerLookupService } from './customer-lookup.service';
import { LookupThrottleService } from './lookup-throttle.service';

@Module({
  imports: [SalesScopeModule],
  controllers: [CustomerLookupController],
  providers: [CustomerLookupService, LookupThrottleService],
  exports: [CustomerLookupService, LookupThrottleService],
})
export class CustomerLookupModule {}
