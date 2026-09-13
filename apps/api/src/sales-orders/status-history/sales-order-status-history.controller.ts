import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SalesOrderStatusHistoryService } from './sales-order-status-history.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/** Read-only. No create/update/delete endpoint exists — decision #1. */
@Controller('sales-orders/:salesOrderId/status-history')
@UseGuards(JwtAuthGuard)
export class SalesOrderStatusHistoryController {
  constructor(
    private readonly statusHistoryService: SalesOrderStatusHistoryService,
  ) {}

  @Get()
  findAll(@Param('salesOrderId') salesOrderId: string) {
    return this.statusHistoryService.findAllForOrder(salesOrderId);
  }
}
