import { Module } from '@nestjs/common';
import { ProductsModule } from '../../products/products.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { RecipesModule } from '../../recipes/recipes.module';
import { AgentsAdminModule } from '../admin/agents-admin.module';
import { AgentOrdersModule } from '../orders/agent-orders.module';
import { AgentFinanceModule } from '../finance/agent-finance.module';
import { AgentPermissionGuard } from '../common/agent-permission.guard';
import { StoreOrderDuplicatesModule } from '../../store-orders/duplicates/store-order-duplicates.module';
import { StoreOrderAmendmentsModule } from '../../store-orders/amendments/store-order-amendments.module';
import {
  AgentPortalFinanceController,
  AgentPortalHomeController,
  AgentPortalLeadsController,
  AgentPortalOrdersController,
  AgentPortalTeamController,
} from './agent-portal.controllers';
import { AgentPortalService } from './agent-portal.service';
import { AgentPortalOrdersService } from './agent-portal-orders.service';
import { AgentPortalTeamService } from './agent-portal-team.service';

/** Agent portal API — `/agent-portal/*` (specs/agents-fulfillment-partners §3, §10). */
@Module({
  imports: [
    ProductsModule,
    InventoryModule,
    RecipesModule,
    AgentsAdminModule,
    AgentOrdersModule,
    AgentFinanceModule,
    StoreOrderDuplicatesModule,
    StoreOrderAmendmentsModule,
  ],
  controllers: [
    AgentPortalHomeController,
    AgentPortalLeadsController,
    AgentPortalOrdersController,
    AgentPortalFinanceController,
    AgentPortalTeamController,
  ],
  providers: [
    AgentPermissionGuard,
    AgentPortalService,
    AgentPortalOrdersService,
    AgentPortalTeamService,
  ],
})
export class AgentPortalModule {}
