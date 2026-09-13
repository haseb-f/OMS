import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/** Read-only. Shipments are created/updated only via SalesOrdersController's business operations. */
@Controller('sales-orders/:salesOrderId/shipments')
@UseGuards(JwtAuthGuard)
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Get()
  findAll(@Param('salesOrderId') salesOrderId: string) {
    return this.shipmentsService.findAllForOrder(salesOrderId);
  }
}
