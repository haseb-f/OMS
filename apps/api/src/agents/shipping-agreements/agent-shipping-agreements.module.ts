import { Module } from '@nestjs/common';
import { NumberingModule } from '../../numbering/numbering.module';
import { MasterDataModule } from '../../master-data/master-data.module';
import { AgentShippingAgreementsController } from './agent-shipping-agreements.controller';
import { AgentShippingAgreementsService } from './agent-shipping-agreements.service';

/** Agent shipping agreements (R15 D15-13) — Agent → Settings. */
@Module({
  imports: [NumberingModule, MasterDataModule],
  controllers: [AgentShippingAgreementsController],
  providers: [AgentShippingAgreementsService],
  exports: [AgentShippingAgreementsService],
})
export class AgentShippingAgreementsModule {}
