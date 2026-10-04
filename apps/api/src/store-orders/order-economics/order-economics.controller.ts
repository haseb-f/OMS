import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import { OrderEconomicsService } from './order-economics.service';

/**
 * ADR-0018 — read-only. Gated by `orders.profitability.view`, never implied
 * by plain `store-orders.view`: COGS/margin/contribution is company-
 * sensitive in a way order status/customer/shipping fields are not. The
 * permission widens WHAT is shown, never WHICH orders: the caller's own
 * by-id scope still applies (R7 review).
 */
@Controller('store-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('store-orders')
export class OrderEconomicsController {
  constructor(
    private readonly orderEconomicsService: OrderEconomicsService,
    private readonly salesScope: SalesScopeService,
  ) {}

  @Get(':id/economics')
  @PermissionAction('profitability_view')
  async getEconomics(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.salesScope.assertCanOpenStoreOrder(user.sub, id);
    return this.orderEconomicsService.getForStoreOrder(id);
  }
}
