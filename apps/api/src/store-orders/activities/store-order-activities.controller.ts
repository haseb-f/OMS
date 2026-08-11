import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { StoreOrderActivityService } from './store-order-activity.service';

/** Read-only. Activities are written only as a side effect of StoreOrdersService's own business operations. */
@Controller('store-orders/:storeOrderId/activities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('store-orders')
export class StoreOrderActivitiesController {
  constructor(private readonly activityService: StoreOrderActivityService) {}

  @Get()
  findAll(@Param('storeOrderId') storeOrderId: string) {
    return this.activityService.findAllForOrder(storeOrderId);
  }
}
