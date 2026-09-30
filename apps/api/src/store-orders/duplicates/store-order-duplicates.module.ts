import { Module } from '@nestjs/common';
import { PartnersModule } from '../../partners/partners.module';
import { StoreOrderDuplicatesService } from './store-order-duplicates.service';
import { StoreOrderDuplicateReviewService } from './store-order-duplicate-review.service';
import { StoreOrderDuplicatesController } from './store-order-duplicates.controller';

/**
 * Round 5 Spec 1B — its own module so Store Orders, Leads (conversion) and
 * Agent orders / portal can all run the same check without a module cycle.
 */
@Module({
  imports: [PartnersModule],
  controllers: [StoreOrderDuplicatesController],
  providers: [StoreOrderDuplicatesService, StoreOrderDuplicateReviewService],
  exports: [StoreOrderDuplicatesService],
})
export class StoreOrderDuplicatesModule {}
