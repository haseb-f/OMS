import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { InventoryMovementActivityService } from './inventory-movement-activity.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('inventory/movements/:movementId/activities')
@UseGuards(JwtAuthGuard)
export class InventoryMovementActivitiesController {
  constructor(
    private readonly activityService: InventoryMovementActivityService,
  ) {}

  @Get()
  findAll(@Param('movementId') movementId: string) {
    return this.activityService.findAllForMovement(movementId);
  }
}
