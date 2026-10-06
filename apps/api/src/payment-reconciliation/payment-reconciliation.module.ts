import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { StoreOrdersModule } from '../store-orders/store-orders.module';
import { FinancialTransactionsModule } from '../financial-transactions/financial-transactions.module';
import { GoogleSheetsService } from '../import-center/google-sheets.service';
import { ImportMappingTemplatesService } from '../import-center/import-mapping-templates.service';
import { PaymentReconciliationController } from './payment-reconciliation.controller';
import { PaymentReconciliationWorkbenchController } from './payment-reconciliation-workbench.controller';
import { PaymentBulkAcceptService } from './payment-bulk-accept.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PaymentStatementsService } from './payment-statements.service';
import { PaymentMatchingService } from './payment-matching.service';
import { ClaimPostingAdapter } from './claim-posting.adapter';
import { AgentLedgerModule } from '../agents/finance/agent-ledger.module';

/**
 * Provider statements + matching per reconciliation-enabled payment method
 * (payment-declaration-reconciliation). Posting goes through the Payments
 * module (`ClaimPostingAdapter` → `PaymentsService.confirmInTx`); settlement
 * lives in its own module. `GoogleSheetsService` is stateless (it only reads
 * the service-account key from the environment), so it is provided here
 * directly rather than importing the whole Import Center graph — and so is
 * `ImportMappingTemplatesService` (Prisma only), which keeps each method's saved file mapping.
 */
@Module({
  imports: [
    PaymentsModule,
    StoreOrdersModule,
    FinancialTransactionsModule,
    AgentLedgerModule,
  ],
  controllers: [
    PaymentReconciliationController,
    PaymentReconciliationWorkbenchController,
  ],
  providers: [
    PaymentReconciliationService,
    PaymentStatementsService,
    PaymentMatchingService,
    ClaimPostingAdapter,
    GoogleSheetsService,
    ImportMappingTemplatesService,
    PaymentBulkAcceptService,
  ],
  exports: [PaymentMatchingService],
})
export class PaymentReconciliationModule {}
