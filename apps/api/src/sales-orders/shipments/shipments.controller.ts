import { Controller, Get, Param } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';

/** Read-only. Shipments are created/updated only via SalesOrdersController's business operations. */
@Controller('sales-orders/:salesOrderId/shipments')
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Get()
  findAll(@Param('salesOrderId') salesOrderId: string) {
    return this.shipmentsService.findAllForOrder(salesOrderId);
  }
}
