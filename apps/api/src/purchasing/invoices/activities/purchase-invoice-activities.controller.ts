import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PurchaseInvoiceActivityService } from './purchase-invoice-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('purchasing/invoices/:invoiceId/activities')
@UseGuards(JwtAuthGuard)
export class PurchaseInvoiceActivitiesController {
  constructor(
    private readonly activityService: PurchaseInvoiceActivityService,
  ) {}

  @Get()
  findAll(@Param('invoiceId') invoiceId: string) {
    return this.activityService.findAllForInvoice(invoiceId);
  }
}
