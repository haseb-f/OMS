import { Module } from '@nestjs/common';
import { FinancialTransactionsModule } from '../../financial-transactions/financial-transactions.module';
import { NumberingModule } from '../../numbering/numbering.module';
import { AccountMappingModule } from '../account-mapping/account-mapping.module';
import { StoreOrderCollectionService } from './store-order-collection.service';
import { CarrierCodCollectionService } from './carrier-cod-collection.service';

/**
 * Store-order collections (receipts of verified payments, R15 carrier COD
 * expected collections). Imported by `StoreOrdersModule`, so the delivery
 * paths reach `CarrierCodCollectionService.onCodShipmentDelivered` without a
 * circular dependency.
 */
@Module({
  imports: [FinancialTransactionsModule, AccountMappingModule, NumberingModule],
  providers: [StoreOrderCollectionService, CarrierCodCollectionService],
  exports: [StoreOrderCollectionService, CarrierCodCollectionService],
})
export class StoreOrderCollectionModule {}
