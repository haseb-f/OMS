import { Module } from '@nestjs/common';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';
import { SalesOrderActivitiesController } from './activities/sales-order-activities.controller';
import { SalesOrderActivityService } from './activities/sales-order-activity.service';
import { SalesOrderStatusHistoryController } from './status-history/sales-order-status-history.controller';
import { SalesOrderStatusHistoryService } from './status-history/sales-order-status-history.service';
import { ShipmentsController } from './shipments/shipments.controller';
import { ShipmentsService } from './shipments/shipments.service';
import { SalesOrderAttachmentsController } from './attachments/sales-order-attachments.controller';
import { SalesOrderAttachmentsService } from './attachments/sales-order-attachments.service';
import { SalesOrderNotesController } from './notes/sales-order-notes.controller';
import { SalesOrderNotesService } from './notes/sales-order-notes.service';

@Module({
  controllers: [
    SalesOrdersController,
    SalesOrderActivitiesController,
    SalesOrderStatusHistoryController,
    ShipmentsController,
    SalesOrderAttachmentsController,
    SalesOrderNotesController,
  ],
  providers: [
    SalesOrdersService,
    SalesOrderActivityService,
    SalesOrderStatusHistoryService,
    ShipmentsService,
    SalesOrderAttachmentsService,
    SalesOrderNotesService,
  ],
})
export class SalesOrdersModule {}
