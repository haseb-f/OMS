import { Module } from '@nestjs/common';
import { CustomerLookupController } from './customer-lookup.controller';
import { CustomerLookupService } from './customer-lookup.service';
import { LookupThrottleService } from './lookup-throttle.service';

@Module({
  controllers: [CustomerLookupController],
  providers: [CustomerLookupService, LookupThrottleService],
  exports: [CustomerLookupService, LookupThrottleService],
})
export class CustomerLookupModule {}
