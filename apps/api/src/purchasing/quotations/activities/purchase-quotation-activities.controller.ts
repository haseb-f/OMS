import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PurchaseQuotationActivityService } from './purchase-quotation-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('purchasing/quotations/:quotationId/activities')
@UseGuards(JwtAuthGuard)
export class PurchaseQuotationActivitiesController {
  constructor(
    private readonly activityService: PurchaseQuotationActivityService,
  ) {}

  @Get()
  findAll(@Param('quotationId') quotationId: string) {
    return this.activityService.findAllForQuotation(quotationId);
  }
}
