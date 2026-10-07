import { Module } from '@nestjs/common';
import { CustomerLookupModule } from '../customer-lookup/customer-lookup.module';
import { CustomerHistoryController } from './customer-history.controller';
import { CustomerHistoryService } from './customer-history.service';

@Module({
  imports: [CustomerLookupModule],
  controllers: [CustomerHistoryController],
  providers: [CustomerHistoryService],
})
export class CustomerHistoryModule {}
