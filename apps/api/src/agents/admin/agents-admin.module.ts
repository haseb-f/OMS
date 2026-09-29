import { Module } from '@nestjs/common';
import { NumberingModule } from '../../numbering/numbering.module';
import { PartnersModule } from '../../partners/partners.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { MasterDataModule } from '../../master-data/master-data.module';
import { UsersModule } from '../../users/users.module';
import { AgentsController } from './agents.controller';
import { AgentUsersController } from './agent-users.controller';
import { AgentsService } from './agents.service';
import { AgentAgreementsService } from './agent-agreements.service';
import { AgentDestinationsService } from './agent-destinations.service';
import { AgentTeamService, AgentUsersService } from './agent-users.service';
import { AgentCommissionModule } from '../commission/agent-commission.module';

/** Internal agent administration (specs/agents-fulfillment-partners §2–§3). */
@Module({
  imports: [
    NumberingModule,
    PartnersModule,
    InventoryModule,
    UsersModule,
    MasterDataModule,
    AgentCommissionModule,
  ],
  controllers: [AgentsController, AgentUsersController],
  providers: [
    AgentsService,
    AgentAgreementsService,
    AgentDestinationsService,
    AgentUsersService,
    AgentTeamService,
  ],
  exports: [
    AgentsService,
    AgentAgreementsService,
    AgentDestinationsService,
    AgentUsersService,
    AgentTeamService,
  ],
})
export class AgentsAdminModule {}
