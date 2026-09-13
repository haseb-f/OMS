import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SalesOrderNotesService } from './sales-order-notes.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/** GET only here — creation goes through SalesOrdersController's "Add Internal Note" operation. */
@Controller('sales-orders/:salesOrderId/notes')
@UseGuards(JwtAuthGuard)
export class SalesOrderNotesController {
  constructor(
    private readonly salesOrderNotesService: SalesOrderNotesService,
  ) {}

  @Get()
  findAll(@Param('salesOrderId') salesOrderId: string) {
    return this.salesOrderNotesService.findAllForOrder(salesOrderId);
  }
}
