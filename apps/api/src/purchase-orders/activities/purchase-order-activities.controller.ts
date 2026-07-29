import { Controller, Get, Param } from '@nestjs/common';
import { PurchaseOrderActivityService } from './purchase-order-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('purchase-orders/:purchaseOrderId/activities')
export class PurchaseOrderActivitiesController {
  constructor(private readonly activityService: PurchaseOrderActivityService) {}

  @Get()
  findAll(@Param('purchaseOrderId') purchaseOrderId: string) {
    return this.activityService.findAllForPurchaseOrder(purchaseOrderId);
  }
}
