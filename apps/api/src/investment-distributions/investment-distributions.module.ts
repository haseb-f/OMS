import { Module } from '@nestjs/common';
import { ProfitDistributionsController } from './profit-distributions.controller';
import { ProfitDistributionsService } from './profit-distributions.service';
import { DistributionPaymentsController } from './distribution-payments.controller';
import { DistributionPaymentsService } from './distribution-payments.service';
import { NumberingModule } from '../numbering/numbering.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';
import { InvestorLedgerModule } from '../investor-ledger/investor-ledger.module';
import { MasterDataModule } from '../master-data/master-data.module';

/**
 * Investor Engine Milestone 3 — Profit Distribution runs and their
 * payments, same "one module, two closely-coupled services" shape as
 * `investment-profit` (Service + Engine). Kept together because
 * DistributionPaymentsService directly recomputes ProfitDistribution
 * status on every confirm/cancel.
 */
@Module({
  imports: [
    NumberingModule,
    PostingEngineModule,
    InvestorLedgerModule,
    MasterDataModule,
  ],
  controllers: [ProfitDistributionsController, DistributionPaymentsController],
  providers: [ProfitDistributionsService, DistributionPaymentsService],
  exports: [ProfitDistributionsService, DistributionPaymentsService],
})
export class InvestmentDistributionsModule {}
