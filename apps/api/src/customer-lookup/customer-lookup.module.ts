import { Module } from '@nestjs/common';
import { CustomerLookupController } from './customer-lookup.controller';
import { CustomerLookupService } from './customer-lookup.service';

@Module({
  controllers: [CustomerLookupController],
  providers: [CustomerLookupService],
})
export class CustomerLookupModule {}
