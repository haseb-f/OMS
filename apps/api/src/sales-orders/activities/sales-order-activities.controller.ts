import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SalesOrderActivityService } from './sales-order-activity.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('sales-orders/:salesOrderId/activities')
@UseGuards(JwtAuthGuard)
export class SalesOrderActivitiesController {
  constructor(
    private readonly salesOrderActivityService: SalesOrderActivityService,
  ) {}

  @Get()
  findAll(@Param('salesOrderId') salesOrderId: string) {
    return this.salesOrderActivityService.findAllForOrder(salesOrderId);
  }
}
