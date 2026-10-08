import { Module } from '@nestjs/common';
import { AgentFinanceModule } from '../finance/agent-finance.module';
import { AgentOverviewController } from './agent-overview.controller';
import { AgentOverviewService } from './agent-overview.service';

/** Company agent overviews — `/agents-overview`, `/agents/:id/overview` (R15 W1). */
@Module({
  imports: [AgentFinanceModule],
  controllers: [AgentOverviewController],
  providers: [AgentOverviewService],
})
export class AgentOverviewModule {}
