import { Controller, Get, Param } from '@nestjs/common';
import { SalesOrderAttachmentsService } from './sales-order-attachments.service';

/** GET only here — creation goes through SalesOrdersController's "Upload Attachment" / "Upload Shipping Label" operations. */
@Controller('sales-orders/:salesOrderId/attachments')
export class SalesOrderAttachmentsController {
  constructor(
    private readonly salesOrderAttachmentsService: SalesOrderAttachmentsService,
  ) {}

  @Get()
  findAll(@Param('salesOrderId') salesOrderId: string) {
    return this.salesOrderAttachmentsService.findAllForOrder(salesOrderId);
  }
}
