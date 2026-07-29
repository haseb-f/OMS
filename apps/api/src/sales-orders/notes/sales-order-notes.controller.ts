import { Controller, Get, Param } from '@nestjs/common';
import { SalesOrderNotesService } from './sales-order-notes.service';

/** GET only here — creation goes through SalesOrdersController's "Add Internal Note" operation. */
@Controller('sales-orders/:salesOrderId/notes')
export class SalesOrderNotesController {
  constructor(
    private readonly salesOrderNotesService: SalesOrderNotesService,
  ) {}

  @Get()
  findAll(@Param('salesOrderId') salesOrderId: string) {
    return this.salesOrderNotesService.findAllForOrder(salesOrderId);
  }
}
