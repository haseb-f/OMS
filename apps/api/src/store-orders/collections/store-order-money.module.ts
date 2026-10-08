import { Module } from '@nestjs/common';
import { SalesReturnsModule } from '../../sales/returns/sales-returns.module';
import { FinancialTransactionsModule } from '../../financial-transactions/financial-transactions.module';
import { StoreOrderReturnsController } from '../returns/store-order-returns.controller';
import { StoreOrderReturnsService } from '../returns/store-order-returns.service';
import { StoreOrderMoneyController } from './store-order-money.controller';
import { StoreOrderMoneyService } from './store-order-money.service';

/**
 * R15 W5b — a store order's money after the sale: the "Collection" panel
 * (`GET /store-orders/:id/money`) and returns of delivered goods
 * (`/store-orders/:id/returns`). Refunds are recorded through
 * `FinancialTransactionsModule` (`/financial-transactions/refunds/store-orders/:id`),
 * payment reversal through `PaymentsModule` (`/payments/:id/reverse`).
 */
@Module({
  imports: [SalesReturnsModule, FinancialTransactionsModule],
  controllers: [StoreOrderMoneyController, StoreOrderReturnsController],
  providers: [StoreOrderMoneyService, StoreOrderReturnsService],
})
export class StoreOrderMoneyModule {}
