import { Controller, Get, Param } from '@nestjs/common';
import { SalesOrderStatusHistoryService } from './sales-order-status-history.service';

/** Read-only. No create/update/delete endpoint exists — decision #1. */
@Controller('sales-orders/:salesOrderId/status-history')
export class SalesOrderStatusHistoryController {
  constructor(
    private readonly statusHistoryService: SalesOrderStatusHistoryService,
  ) {}

  @Get()
  findAll(@Param('salesOrderId') salesOrderId: string) {
    return this.statusHistoryService.findAllForOrder(salesOrderId);
  }
}
