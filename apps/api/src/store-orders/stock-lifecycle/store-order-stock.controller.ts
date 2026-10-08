import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { SalesScopeService } from '../../sales-scope/sales-scope.service';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { canViewInventoryCost } from '../../inventory/inventory-cost-access';
import { StoreOrderStockService } from './store-order-stock.service';
import { StockBackfillService } from './stock-backfill.service';
import {
  ReceiveBackDto,
  ReserveShortDto,
  StockAvailabilityDto,
  StockBackfillDto,
} from './dto/store-order-stock.dto';

/**
 * R15 W5a (spec §2, §5–§7) — the stock lifecycle of a store order behind the
 * same by-id scope gate as the order itself. The static routes come first
 * (`stock/…`, `stock-backfill`); nothing here clashes with
 * `StoreOrdersController`'s `:id/…` routes.
 */
@Controller('store-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('store-orders')
export class StoreOrderStockController {
  constructor(
    private readonly stock: StoreOrderStockService,
    private readonly backfill: StockBackfillService,
    private readonly salesScope: SalesScopeService,
    private readonly permissions: PermissionsResolverService,
  ) {}

  /**
   * Posted COGS is order-margin data (ADR-0018): shown only with
   * `orders.profitability.view` or the inventory-cost rule, `null` otherwise.
   */
  private async withCostVisibility<T extends { postedCogs: number | null }>(
    userId: string,
    result: T,
  ): Promise<T> {
    if (result.postedCogs === null) return result;
    const visible =
      (await this.permissions.hasPermission(
        userId,
        'orders.profitability.view',
      )) || (await canViewInventoryCost(this.permissions, userId));
    return visible ? result : { ...result, postedCogs: null };
  }

  /** Retry every short order of the caller's scope (`store-orders.manage` never widens the scope). */
  @Post('stock/reserve-short')
  @HttpCode(200)
  @PermissionAction('manage')
  async reserveShort(
    @Body() dto: ReserveShortDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const scope = await this.salesScope.resolve(user.sub);
    return this.stock.reserveShortOrders(
      this.salesScope.storeOrderWhere(scope),
      user.sub,
      dto.limit,
    );
  }

  /** Order forms: availability per line before submit (D15-2). */
  @Post('stock/availability')
  @HttpCode(200)
  @PermissionAction('view')
  availability(@Body() dto: StockAvailabilityDto) {
    return this.stock.availabilityFor(dto.lines);
  }

  /**
   * D15-20 backfill — a super admin only, dry run included: its report spans
   * every pending order company-wide (agent orders too), which no sales scope
   * may see (`store-orders.manage` never widens the scope).
   */
  @Post('stock-backfill')
  @HttpCode(200)
  @PermissionAction('manage')
  async runBackfill(
    @Body() dto: StockBackfillDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const dryRun = dto.dryRun !== false;
    await this.backfill.assertMayApply(user.sub);
    return this.backfill.run({
      dryRun,
      userId: user.sub,
      orderIds: dto.orderIds,
    });
  }

  @Get(':id/stock')
  @PermissionAction('view')
  async view(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    // An archived (cancelled) order still shows where its goods are.
    await this.salesScope.assertCanOpenStoreOrder(user.sub, id, {
      includeArchived: true,
    });
    return this.withCostVisibility(user.sub, await this.stock.view(id));
  }

  /** "Reserve now" — retries the order's missing lines. */
  @Post(':id/stock/reserve')
  @HttpCode(200)
  @PermissionAction('edit')
  async reserve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.salesScope.assertCanOpenStoreOrder(user.sub, id);
    return this.withCostVisibility(
      user.sub,
      await this.stock.reserveNow(id, user.sub),
    );
  }

  /** "Receive returned goods" — physical receipt + inspection of undelivered goods. */
  @Post(':id/stock/receive-back')
  @HttpCode(200)
  @PermissionModule('shipping')
  @PermissionAction('receive_returns')
  async receiveBack(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveBackDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // D15-8 — goods of an order cancelled in transit are received back too.
    await this.salesScope.assertCanOpenStoreOrder(user.sub, id, {
      includeArchived: true,
    });
    return this.withCostVisibility(
      user.sub,
      await this.stock.receiveBack(id, dto, user.sub),
    );
  }
}
