import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PurchaseOrderActivityService } from './purchase-order-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('purchase-orders/:purchaseOrderId/activities')
@UseGuards(JwtAuthGuard)
export class PurchaseOrderActivitiesController {
  constructor(private readonly activityService: PurchaseOrderActivityService) {}

  @Get()
  findAll(@Param('purchaseOrderId') purchaseOrderId: string) {
    return this.activityService.findAllForPurchaseOrder(purchaseOrderId);
  }
}
