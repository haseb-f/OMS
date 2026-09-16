import { Module } from '@nestjs/common';
import { LandedCostDocumentsController } from './landed-cost-documents.controller';
import { LandedCostDocumentsService } from './landed-cost-documents.service';
import { NumberingModule } from '../numbering/numbering.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';
import { CostComponentsModule } from '../cost-components/cost-components.module';

@Module({
  imports: [NumberingModule, PostingEngineModule, CostComponentsModule],
  controllers: [LandedCostDocumentsController],
  providers: [LandedCostDocumentsService],
  exports: [LandedCostDocumentsService],
})
export class LandedCostDocumentsModule {}
