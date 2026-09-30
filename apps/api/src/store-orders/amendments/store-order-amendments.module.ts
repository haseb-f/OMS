import { Module } from '@nestjs/common';
import { NumberingModule } from '../../numbering/numbering.module';
import { WorkflowModule } from '../../workflow/workflow.module';
import { StoreOrdersModule } from '../store-orders.module';
import { StoreOrderDuplicatesModule } from '../duplicates/store-order-duplicates.module';
import { AgentOrdersModule } from '../../agents/orders/agent-orders.module';
import { AgentLedgerModule } from '../../agents/finance/agent-ledger.module';
import { StoreOrderAmendmentsService } from './store-order-amendments.service';
import { StoreOrderAmendmentsController } from './store-order-amendments.controller';

/**
 * Round 5 Spec 1A — order amendments. Its own module (above Store Orders and
 * Agent orders) so the internal controller and the agent portal share one
 * service without a module cycle.
 */
@Module({
  imports: [
    NumberingModule,
    WorkflowModule,
    StoreOrdersModule,
    StoreOrderDuplicatesModule,
    AgentOrdersModule,
    AgentLedgerModule,
  ],
  controllers: [StoreOrderAmendmentsController],
  providers: [StoreOrderAmendmentsService],
  exports: [StoreOrderAmendmentsService],
})
export class StoreOrderAmendmentsModule {}
