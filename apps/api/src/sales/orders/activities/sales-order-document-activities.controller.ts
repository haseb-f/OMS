import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { SalesOrderDocumentActivityService } from './sales-order-document-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('sales/orders/:orderId/activities')
@UseGuards(JwtAuthGuard)
export class SalesOrderDocumentActivitiesController {
  constructor(
    private readonly activityService: SalesOrderDocumentActivityService,
  ) {}

  @Get()
  findAll(@Param('orderId') orderId: string) {
    return this.activityService.findAllForOrder(orderId);
  }
}
