import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import { StoreOrderActivityService } from './store-order-activity.service';

/**
 * Read-only. Activities are written only as a side effect of
 * StoreOrdersService's own business operations. The list is behind the same
 * by-id scope gate as the order itself (R7 review: it used to be unscoped,
 * so any `store-orders.view` holder could read another owner's history).
 */
@Controller('store-orders/:storeOrderId/activities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('store-orders')
export class StoreOrderActivitiesController {
  constructor(
    private readonly activityService: StoreOrderActivityService,
    private readonly salesScope: SalesScopeService,
  ) {}

  @Get()
  async findAll(
    @Param('storeOrderId') storeOrderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.salesScope.assertCanOpenStoreOrder(user.sub, storeOrderId);
    return this.activityService.findAllForOrder(storeOrderId);
  }
}
