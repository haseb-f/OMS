import { Module } from '@nestjs/common';
import { NumberingModule } from '../../numbering/numbering.module';
import { PostingEngineModule } from '../../accounting/posting-engine/posting-engine.module';
import { AccountMappingModule } from '../../accounting/account-mapping/account-mapping.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { StockLinesModule } from '../../inventory/stock-lines/stock-lines.module';
import { RecipesModule } from '../../recipes/recipes.module';
import { AgentLedgerService } from './agent-ledger.service';
import { AgentFulfillmentService } from './agent-fulfillment.service';
import { AgentCollectionHooksService } from './agent-collection-hooks.service';
import { AgentShippingPricingService } from '../pricing/agent-shipping-pricing.service';

/**
 * Agent ledger core + the hooks other modules call inside their own
 * transactions (shipments, pickup, payments, reconciliation, settlements).
 * Deliberately imports no Store Orders / Payments module, so those modules
 * can import this one without a cycle. The AGENT_* posting provider is
 * registered by `PostingProvidersModule` like every other provider.
 */
@Module({
  imports: [
    NumberingModule,
    PostingEngineModule,
    AccountMappingModule,
    InventoryModule,
    StockLinesModule,
    RecipesModule,
  ],
  providers: [
    AgentLedgerService,
    AgentFulfillmentService,
    AgentCollectionHooksService,
    AgentShippingPricingService,
  ],
  exports: [
    AgentLedgerService,
    AgentFulfillmentService,
    AgentCollectionHooksService,
    AgentShippingPricingService,
  ],
})
export class AgentLedgerModule {}
