import { Module } from '@nestjs/common';
import { NumberingModule } from '../../numbering/numbering.module';
import { InventoryModule } from '../../inventory/inventory.module';
import {
  AgentStockMovementsController,
  AgentStockReceiptsController,
} from './agent-stock.controller';
import { AgentStockReceiptsService } from './agent-stock-receipts.service';
import { AgentStockHistoryService } from './agent-stock-history.service';

/** R18 B — agent-owned consignment stock: receipts + movement history (thin layer over the Inventory Engine). */
@Module({
  imports: [NumberingModule, InventoryModule],
  controllers: [AgentStockReceiptsController, AgentStockMovementsController],
  providers: [AgentStockReceiptsService, AgentStockHistoryService],
  exports: [AgentStockReceiptsService, AgentStockHistoryService],
})
export class AgentStockModule {}
