import { Module } from '@nestjs/common';
import { NumberingModule } from '../../numbering/numbering.module';
import { PostingEngineModule } from '../../accounting/posting-engine/posting-engine.module';
import { AccountMappingModule } from '../../accounting/account-mapping/account-mapping.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { AgentLedgerService } from './agent-ledger.service';
import { AgentFulfillmentService } from './agent-fulfillment.service';
import { AgentCollectionHooksService } from './agent-collection-hooks.service';

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
  ],
  providers: [
    AgentLedgerService,
    AgentFulfillmentService,
    AgentCollectionHooksService,
  ],
  exports: [
    AgentLedgerService,
    AgentFulfillmentService,
    AgentCollectionHooksService,
  ],
})
export class AgentLedgerModule {}
