import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PurchaseReturnActivityService } from './purchase-return-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('purchasing/returns/:returnId/activities')
@UseGuards(JwtAuthGuard)
export class PurchaseReturnActivitiesController {
  constructor(
    private readonly activityService: PurchaseReturnActivityService,
  ) {}

  @Get()
  findAll(@Param('returnId') returnId: string) {
    return this.activityService.findAllForReturn(returnId);
  }
}
