import { Module } from '@nestjs/common';
import { AgentCommissionRatesService } from './agent-commission-rates.service';

/** Commission rates and item overrides (commission-policy.md A3–A4). */
@Module({
  providers: [AgentCommissionRatesService],
  exports: [AgentCommissionRatesService],
})
export class AgentCommissionModule {}
