import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { SalesReturnActivityService } from './sales-return-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('sales/returns/:returnId/activities')
@UseGuards(JwtAuthGuard)
export class SalesReturnActivitiesController {
  constructor(private readonly activityService: SalesReturnActivityService) {}

  @Get()
  findAll(@Param('returnId') returnId: string) {
    return this.activityService.findAllForReturn(returnId);
  }
}
