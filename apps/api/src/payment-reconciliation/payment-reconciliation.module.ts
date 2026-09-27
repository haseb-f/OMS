import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { StoreOrdersModule } from '../store-orders/store-orders.module';
import { FinancialTransactionsModule } from '../financial-transactions/financial-transactions.module';
import { GoogleSheetsService } from '../import-center/google-sheets.service';
import { PaymentReconciliationController } from './payment-reconciliation.controller';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentStatementsService } from './payment-statements.service';
import { PaymentMatchingService } from './payment-matching.service';
import { ClaimPostingAdapter } from './claim-posting.adapter';

/**
 * Provider statements + matching per reconciliation-enabled payment method
 * (payment-declaration-reconciliation). Posting goes through the Payments
 * module (`ClaimPostingAdapter` → `PaymentsService.confirmInTx`); settlement
 * lives in its own module. `GoogleSheetsService` is stateless (it only reads
 * the service-account key from the environment), so it is provided here
 * directly rather than importing the whole Import Center graph.
 */
@Module({
  imports: [PaymentsModule, StoreOrdersModule, FinancialTransactionsModule],
  controllers: [PaymentReconciliationController],
  providers: [
    PaymentReconciliationService,
    PaymentStatementsService,
    PaymentMatchingService,
    ClaimPostingAdapter,
    GoogleSheetsService,
  ],
  exports: [PaymentMatchingService],
})
export class PaymentReconciliationModule {}
