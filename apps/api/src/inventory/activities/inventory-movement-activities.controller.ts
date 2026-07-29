import { Controller, Get, Param } from '@nestjs/common';
import { InventoryMovementActivityService } from './inventory-movement-activity.service';

/** Read-only: activities are system-generated, never created directly by a client. */
@Controller('inventory/movements/:movementId/activities')
export class InventoryMovementActivitiesController {
  constructor(
    private readonly activityService: InventoryMovementActivityService,
  ) {}

  @Get()
  findAll(@Param('movementId') movementId: string) {
    return this.activityService.findAllForMovement(movementId);
  }
}
