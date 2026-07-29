import { Controller, Get, Param } from '@nestjs/common';
import { SalesOrderActivityService } from './sales-order-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('sales-orders/:salesOrderId/activities')
export class SalesOrderActivitiesController {
  constructor(
    private readonly salesOrderActivityService: SalesOrderActivityService,
  ) {}

  @Get()
  findAll(@Param('salesOrderId') salesOrderId: string) {
    return this.salesOrderActivityService.findAllForOrder(salesOrderId);
  }
}
