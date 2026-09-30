import { Module } from '@nestjs/common';
import { StoreOrdersModule } from '../../store-orders/store-orders.module';
import { WorkflowModule } from '../../workflow/workflow.module';
import { LeadsModule } from '../../leads/leads.module';
import { AgentCommissionModule } from '../commission/agent-commission.module';
import { StoreOrderDuplicatesModule } from '../../store-orders/duplicates/store-order-duplicates.module';
import {
  AgentOrdersController,
  AgentWorkspaceOrdersController,
} from './agent-orders.controller';
import { AgentOrdersService } from './agent-orders.service';
import { AgentLeadsService } from './agent-leads.service';

/** Agent orders and leads (specs/agents-fulfillment-partners §4–§6). */
@Module({
  imports: [
    StoreOrdersModule,
    WorkflowModule,
    LeadsModule,
    AgentCommissionModule,
    StoreOrderDuplicatesModule,
  ],
  controllers: [AgentOrdersController, AgentWorkspaceOrdersController],
  providers: [AgentOrdersService, AgentLeadsService],
  exports: [AgentOrdersService, AgentLeadsService],
})
export class AgentOrdersModule {}
