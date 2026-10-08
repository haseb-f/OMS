import { Global, Module } from '@nestjs/common';
import { InventoryModule } from '../../inventory/inventory.module';
import { StockLinesModule } from '../../inventory/stock-lines/stock-lines.module';
import { SalesScopeModule } from '../../sales-scope/sales-scope.module';
import { StoreOrderActivityService } from '../activities/store-order-activity.service';
import { StoreOrderStockService } from './store-order-stock.service';
import { StockBackfillService } from './stock-backfill.service';
import { StoreOrderStockController } from './store-order-stock.controller';

/**
 * R15 W5a — the store-order stock lifecycle. Global (like `SalesScopeModule`)
 * because every order path calls it: creation (`StoreOrdersModule`), lead
 * conversion (`WorkflowModule`), the shipment operations and the shipping
 * import (`ImportCenterModule`), the agent fulfillment hooks
 * (`AgentLedgerModule`) and the amendments — it depends only on inventory,
 * so none of them gets a module cycle. Imported once by `StoreOrdersModule`.
 * `StoreOrderActivityService` is stateless (Prisma only); this module keeps
 * its own instance instead of importing `StoreOrdersModule` (a cycle).
 */
@Global()
@Module({
  // SalesScopeModule (the controller's by-id gate) is global in the app; it is
  // imported here too so a module tree without it still boots.
  imports: [InventoryModule, StockLinesModule, SalesScopeModule],
  controllers: [StoreOrderStockController],
  providers: [
    StoreOrderStockService,
    StockBackfillService,
    StoreOrderActivityService,
  ],
  exports: [StoreOrderStockService, StockBackfillService],
})
export class StoreOrderStockModule {}
