import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { OrderEconomicsService } from './order-economics.service';

/**
 * ADR-0018 — read-only. Gated by `orders.profitability.view`, never implied
 * by plain `store-orders.view`: COGS/margin/contribution is company-
 * sensitive in a way order status/customer/shipping fields are not.
 */
@Controller('store-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('store-orders')
export class OrderEconomicsController {
  constructor(private readonly orderEconomicsService: OrderEconomicsService) {}

  @Get(':id/economics')
  @PermissionAction('profitability_view')
  getEconomics(@Param('id') id: string) {
    return this.orderEconomicsService.getForStoreOrder(id);
  }
}
