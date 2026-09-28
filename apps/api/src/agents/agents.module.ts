import { Module } from '@nestjs/common';
import { AgentPermissionGuard } from './common/agent-permission.guard';
import { AgentsAdminModule } from './admin/agents-admin.module';
import { AgentOrdersModule } from './orders/agent-orders.module';
import { AgentFinanceModule } from './finance/agent-finance.module';
import { AgentPortalModule } from './portal/agent-portal.module';

/**
 * Agents / Fulfillment Partners (specs/agents-fulfillment-partners). Root
 * module; feature sub-modules (admin, orders, finance, portal) are imported
 * here as they land.
 */
@Module({
  imports: [
    AgentsAdminModule,
    AgentOrdersModule,
    AgentFinanceModule,
    AgentPortalModule,
  ],
  providers: [AgentPermissionGuard],
  exports: [
    AgentPermissionGuard,
    AgentsAdminModule,
    AgentOrdersModule,
    AgentFinanceModule,
  ],
})
export class AgentsModule {}
