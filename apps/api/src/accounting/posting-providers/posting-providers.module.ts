import { Module } from '@nestjs/common';
import { PostingEngineModule } from '../posting-engine/posting-engine.module';
import { InventoryValuationModule } from '../inventory-valuation/inventory-valuation.module';
import { AccountMappingModule } from '../account-mapping/account-mapping.module';
import { SalesInvoicePostingProvider } from './sales-invoice-posting.provider';
import { SalesReturnPostingProvider } from './sales-return-posting.provider';
import { PurchaseInvoicePostingProvider } from './purchase-invoice-posting.provider';
import { PurchaseReturnPostingProvider } from './purchase-return-posting.provider';
import { FinancialTransactionPostingProvider } from './financial-transaction-posting.provider';
import { InventoryAdjustmentPostingProvider } from './inventory-adjustment-posting.provider';

/**
 * Accounting Posting Engine (TASK-046/047) — every default Posting
 * Provider, one per module (Sales, Purchasing, Financial Transactions,
 * Inventory Adjustments — Payroll/Manufacturing are future work, not built
 * here). Each provider self-registers with the shared
 * `PostingEngineService` in its own `onModuleInit()`; this module's only
 * job is to instantiate them (imported once from `AppModule`) and give
 * them read access to `InventoryValuationService`/`AccountMappingService`.
 * None of the six providers import a Sales/Purchasing/Inventory/
 * FinancialTransactions module, and none reads an account id directly
 * (that's `AccountMappingService`'s job) — they only read source-document
 * tables via raw Prisma.
 */
@Module({
  imports: [
    PostingEngineModule,
    InventoryValuationModule,
    AccountMappingModule,
  ],
  providers: [
    SalesInvoicePostingProvider,
    SalesReturnPostingProvider,
    PurchaseInvoicePostingProvider,
    PurchaseReturnPostingProvider,
    FinancialTransactionPostingProvider,
    InventoryAdjustmentPostingProvider,
  ],
})
export class PostingProvidersModule {}
