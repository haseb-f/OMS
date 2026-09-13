import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SalesOrderAttachmentsService } from './sales-order-attachments.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/** GET only here — creation goes through SalesOrdersController's "Upload Attachment" / "Upload Shipping Label" operations. */
@Controller('sales-orders/:salesOrderId/attachments')
@UseGuards(JwtAuthGuard)
export class SalesOrderAttachmentsController {
  constructor(
    private readonly salesOrderAttachmentsService: SalesOrderAttachmentsService,
  ) {}

  @Get()
  findAll(@Param('salesOrderId') salesOrderId: string) {
    return this.salesOrderAttachmentsService.findAllForOrder(salesOrderId);
  }
}
