import { Module } from '@nestjs/common';
import { FinancialTransactionsModule } from '../../financial-transactions/financial-transactions.module';
import { AccountMappingModule } from '../account-mapping/account-mapping.module';
import { StoreOrderCollectionService } from './store-order-collection.service';

@Module({
  imports: [FinancialTransactionsModule, AccountMappingModule],
  providers: [StoreOrderCollectionService],
  exports: [StoreOrderCollectionService],
})
export class StoreOrderCollectionModule {}
