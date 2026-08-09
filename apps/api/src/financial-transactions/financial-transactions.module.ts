import { Module } from '@nestjs/common';
import { CustomerReceiptsController } from './receipts/customer-receipts.controller';
import { CustomerReceiptActivitiesController } from './receipts/activities/customer-receipt-activities.controller';
import { SupplierPaymentsController } from './payments/supplier-payments.controller';
import { SupplierPaymentActivitiesController } from './payments/activities/supplier-payment-activities.controller';
import { FinancialTransactionsService } from './financial-transactions.service';
import { FinancialTransactionActivityService } from './activities/financial-transaction-activity.service';
import { CustomersModule } from '../customers/customers.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { NumberingModule } from '../numbering/numbering.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';

/**
 * TASK-043 — one service behind both Customer Receipts and Supplier
 * Payments (see FinancialTransactionsService's own doc comment). No
 * dependency on SalesInvoicesModule/PurchaseInvoicesModule — invoices are
 * only ever read via raw Prisma here, never mutated, so importing those
 * modules would add coupling with no benefit.
 */
@Module({
  imports: [
    CustomersModule,
    SuppliersModule,
    NumberingModule,
    PostingEngineModule,
  ],
  controllers: [
    CustomerReceiptsController,
    CustomerReceiptActivitiesController,
    SupplierPaymentsController,
    SupplierPaymentActivitiesController,
  ],
  providers: [
    FinancialTransactionsService,
    FinancialTransactionActivityService,
  ],
  exports: [FinancialTransactionsService],
})
export class FinancialTransactionsModule {}
