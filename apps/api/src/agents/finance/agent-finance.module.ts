import { Module } from '@nestjs/common';
import { NumberingModule } from '../../numbering/numbering.module';
import { PostingEngineModule } from '../../accounting/posting-engine/posting-engine.module';
import { PaymentsModule } from '../../payments/payments.module';
import { StoreOrdersModule } from '../../store-orders/store-orders.module';
import { AgentLedgerModule } from './agent-ledger.module';
import { AgentStatementService } from './agent-statement.service';
import { AgentPayoutsService } from './agent-payouts.service';
import { AgentCollectionsService } from './agent-collections.service';
import { AgentAdjustmentsService } from './agent-adjustments.service';
import { AgentFinanceController } from './agent-finance.controller';
import { AgentReturnsController } from './agent-returns.controller';

/**
 * Agents finance (specs/agents-fulfillment-partners §7–§10): internal
 * Finance/Shipping endpoints. Exports the read services (statement,
 * summary, dashboard, payouts, payment stages) for the agent portal (B3),
 * which always passes the server-derived agentId.
 */
@Module({
  imports: [
    NumberingModule,
    PostingEngineModule,
    PaymentsModule,
    StoreOrdersModule,
    AgentLedgerModule,
  ],
  controllers: [AgentFinanceController, AgentReturnsController],
  providers: [
    AgentStatementService,
    AgentPayoutsService,
    AgentCollectionsService,
    AgentAdjustmentsService,
  ],
  exports: [AgentStatementService, AgentPayoutsService, AgentLedgerModule],
})
export class AgentFinanceModule {}
