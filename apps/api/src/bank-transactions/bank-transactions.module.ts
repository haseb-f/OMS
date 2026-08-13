import { Module } from '@nestjs/common';
import { BankTransactionsController } from './bank-transactions.controller';
import { BankTransactionsService } from './bank-transactions.service';
import { CashFlowReconciliationService } from './cash-flow-reconciliation.service';
import { PaymentsModule } from '../payments/payments.module';
import { StoreOrdersModule } from '../store-orders/store-orders.module';
import { FinancialTransactionsModule } from '../financial-transactions/financial-transactions.module';

@Module({
  imports: [PaymentsModule, StoreOrdersModule, FinancialTransactionsModule],
  controllers: [BankTransactionsController],
  providers: [BankTransactionsService, CashFlowReconciliationService],
  exports: [BankTransactionsService, CashFlowReconciliationService],
})
export class BankTransactionsModule {}
