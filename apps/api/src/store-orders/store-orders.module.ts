import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { NumberingModule } from '../numbering/numbering.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';
import { StoreOrdersController } from './store-orders.controller';
import { StoreOrdersService } from './store-orders.service';
import { StoreOrderActivityService } from './activities/store-order-activity.service';
import { StoreOrderActivitiesController } from './activities/store-order-activities.controller';
import { StoreOrderPaymentSyncService } from './store-order-payment-sync.service';
import { StoreOrderShipmentsService } from './shipments/store-order-shipments.service';
import { StoreOrderShipmentOperationsService } from './shipments/store-order-shipment-operations.service';
import { StoreOrderShipmentsController } from './shipments/store-order-shipments.controller';
import { ShippingController } from './shipments/shipping.controller';

@Module({
  imports: [CustomersModule, NumberingModule, PostingEngineModule],
  controllers: [
    StoreOrdersController,
    StoreOrderActivitiesController,
    StoreOrderShipmentsController,
    ShippingController,
  ],
  providers: [
    StoreOrdersService,
    StoreOrderActivityService,
    StoreOrderPaymentSyncService,
    StoreOrderShipmentsService,
    StoreOrderShipmentOperationsService,
  ],
  // `StoreOrderPaymentSyncService` is exported so `PaymentsModule` can keep
  // `StoreOrder.paymentStatus` in sync after Match/Verify/Reject without a
  // circular module dependency (see that service's own doc comment).
  // `StoreOrderShipmentsService`/`StoreOrderActivityService` are exported so
  // `ImportCenterModule`'s `ShippingUpdatesImportHandler`/
  // `StoreOrdersImportHandler` can reuse them directly, the same "call the
  // real service, never a parallel write path" rule every other handler
  // follows.
  exports: [
    StoreOrdersService,
    StoreOrderPaymentSyncService,
    StoreOrderShipmentsService,
    StoreOrderActivityService,
  ],
})
export class StoreOrdersModule {}
