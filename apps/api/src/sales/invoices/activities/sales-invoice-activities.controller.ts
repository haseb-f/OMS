import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { SalesInvoiceActivityService } from './sales-invoice-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('sales/invoices/:invoiceId/activities')
@UseGuards(JwtAuthGuard)
export class SalesInvoiceActivitiesController {
  constructor(private readonly activityService: SalesInvoiceActivityService) {}

  @Get()
  findAll(@Param('invoiceId') invoiceId: string) {
    return this.activityService.findAllForInvoice(invoiceId);
  }
}
