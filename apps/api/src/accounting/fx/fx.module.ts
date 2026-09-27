import { Module } from '@nestjs/common';
import { NumberingModule } from '../../numbering/numbering.module';
import { PostingEngineModule } from '../posting-engine/posting-engine.module';
import { ExchangeRatesService } from './exchange-rates.service';
import { FxRevaluationService } from './fx-revaluation.service';
import { FxCorrectionService } from './fx-correction.service';
import { FxOverridesService } from './fx-overrides.service';
import { FxSyncService } from './fx-sync.service';
import { FxRatesCronController } from './fx-rates-cron.controller';
import { CbeFxProvider } from './providers/cbe.provider';
import { FX_RATE_PROVIDER } from './providers/fx-provider.types';
import {
  ExchangeRatesController,
  FxRevaluationsController,
} from './fx.controller';

@Module({
  imports: [NumberingModule, PostingEngineModule],
  controllers: [
    ExchangeRatesController,
    FxRevaluationsController,
    FxRatesCronController,
  ],
  providers: [
    ExchangeRatesService,
    FxRevaluationService,
    FxCorrectionService,
    FxOverridesService,
    FxSyncService,
    CbeFxProvider,
    { provide: FX_RATE_PROVIDER, useExisting: CbeFxProvider },
  ],
  exports: [
    ExchangeRatesService,
    FxRevaluationService,
    FxOverridesService,
    FxSyncService,
  ],
})
export class FxModule {}
