import { Module } from '@nestjs/common';
import { NumberingModule } from '../../numbering/numbering.module';
import { PostingEngineModule } from '../posting-engine/posting-engine.module';
import { ExchangeRatesService } from './exchange-rates.service';
import { FxRevaluationService } from './fx-revaluation.service';
import {
  ExchangeRatesController,
  FxRevaluationsController,
} from './fx.controller';

@Module({
  imports: [NumberingModule, PostingEngineModule],
  controllers: [ExchangeRatesController, FxRevaluationsController],
  providers: [ExchangeRatesService, FxRevaluationService],
  exports: [ExchangeRatesService, FxRevaluationService],
})
export class FxModule {}
