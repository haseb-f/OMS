import { Module } from '@nestjs/common';
import { CapitalReturnsController } from './capital-returns.controller';
import { CapitalReturnsService } from './capital-returns.service';
import { CapitalReturnCorrectionService } from './capital-return-correction.service';
import { CapitalReturnCorrectionsController } from './capital-return-corrections.controller';
import { NumberingModule } from '../numbering/numbering.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';
import { InvestorLedgerModule } from '../investor-ledger/investor-ledger.module';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [
    NumberingModule,
    PostingEngineModule,
    InvestorLedgerModule,
    MasterDataModule,
  ],
  controllers: [CapitalReturnCorrectionsController, CapitalReturnsController],
  providers: [CapitalReturnsService, CapitalReturnCorrectionService],
  exports: [CapitalReturnsService],
})
export class CapitalReturnsModule {}
