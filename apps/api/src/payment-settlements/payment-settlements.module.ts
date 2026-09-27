import { Module } from '@nestjs/common';
import { NumberingModule } from '../numbering/numbering.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';
import { FxModule } from '../accounting/fx/fx.module';
import { FiscalPeriodsModule } from '../accounting/fiscal-periods/fiscal-periods.module';
import { PaymentSettlementsController } from './payment-settlements.controller';
import { PaymentSettlementsService } from './payment-settlements.service';
import { PaymentSettlementPostingProvider } from './payment-settlement-posting.provider';

/**
 * Batch provider settlement (payment-declaration-reconciliation, IMPL-SET).
 * The PAYMENT_SETTLEMENT posting provider self-registers with the shared
 * PostingEngineService singleton on module init, like every other provider.
 */
@Module({
  imports: [
    NumberingModule,
    PostingEngineModule,
    FxModule,
    FiscalPeriodsModule,
  ],
  controllers: [PaymentSettlementsController],
  providers: [PaymentSettlementsService, PaymentSettlementPostingProvider],
  exports: [PaymentSettlementsService],
})
export class PaymentSettlementsModule {}
