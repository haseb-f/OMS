import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { SalesQuotationActivityService } from './sales-quotation-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('sales/quotations/:quotationId/activities')
@UseGuards(JwtAuthGuard)
export class SalesQuotationActivitiesController {
  constructor(
    private readonly activityService: SalesQuotationActivityService,
  ) {}

  @Get()
  findAll(@Param('quotationId') quotationId: string) {
    return this.activityService.findAllForQuotation(quotationId);
  }
}
