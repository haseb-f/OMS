import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { OpeningBalanceDto } from './dto/opening-balance.dto';
import { AdjustmentDto } from './dto/adjustment.dto';
import { TransferDto } from './dto/transfer.dto';
import { DamageDto } from './dto/damage.dto';
import { ExpiredDto } from './dto/expired.dto';
import { ReserveDto } from './dto/reserve.dto';
import { ReleaseDto } from './dto/release.dto';
import { FindMovementsQueryDto } from './dto/find-movements-query.dto';
import { GetStockQueryDto } from './dto/get-stock-query.dto';
import { UpdateValuationMethodDto } from './dto/update-valuation-method.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/**
 * Business operations only — no generic CRUD for inventory movements.
 * Guarded at the class level (TASK-028) so every movement-creating
 * endpoint can attribute `createdBy` to the real caller — previously
 * unguarded, so no movement ever recorded a user.
 */
@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /** "Opening Inventory" is its own Permission Matrix row (Part 3), separate from "Inventory" — method-level override. */
  @Post('opening-balance')
  @PermissionModule('opening-inventory')
  @PermissionAction('create')
  openingBalance(
    @Body() dto: OpeningBalanceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.inventoryService.openingBalance(dto, user.sub);
  }

  @Post('adjustment')
  adjustment(@Body() dto: AdjustmentDto, @CurrentUser() user: JwtPayload) {
    return this.inventoryService.adjustment(dto, user.sub);
  }

  @Post('transfer')
  transfer(@Body() dto: TransferDto, @CurrentUser() user: JwtPayload) {
    return this.inventoryService.transfer(dto, user.sub);
  }

  @Post('damage')
  damage(@Body() dto: DamageDto, @CurrentUser() user: JwtPayload) {
    return this.inventoryService.damage(dto, user.sub);
  }

  @Post('expired')
  expired(@Body() dto: ExpiredDto, @CurrentUser() user: JwtPayload) {
    return this.inventoryService.expired(dto, user.sub);
  }

  @Post('reserve')
  reserve(@Body() dto: ReserveDto, @CurrentUser() user: JwtPayload) {
    return this.inventoryService.reserve(dto, user.sub);
  }

  @Post('release')
  release(@Body() dto: ReleaseDto, @CurrentUser() user: JwtPayload) {
    return this.inventoryService.release(dto, user.sub);
  }

  /** Derived current stock (on-hand / reserved / available) — never stored directly. */
  @Get('stock')
  getStock(@Query() query: GetStockQueryDto) {
    return this.inventoryService.getStock(query.productId, query.warehouseId);
  }

  @Get('movements')
  findAllMovements(@Query() query: FindMovementsQueryDto) {
    return this.inventoryService.findAllMovements(query);
  }

  @Get('movements/:id')
  findOneMovement(@Param('id') id: string) {
    return this.inventoryService.findOneMovement(id);
  }

  /** Product Stock Card — every inventory product's on-hand/reserved/available/cost/last movement, in one call. */
  @Get('stock-cards')
  getStockCards() {
    return this.inventoryService.getStockCards();
  }

  @Get('stock-card/:productId')
  getStockCard(@Param('productId') productId: string) {
    return this.inventoryService.getStockCard(productId);
  }

  /** Warehouse Balance report (TASK-029) — on-hand quantity per product, per warehouse. */
  @Get('warehouse-balances')
  getWarehouseBalances() {
    return this.inventoryService.getWarehouseBalances();
  }

  @Get('valuation-method')
  @SkipPermissionCheck()
  getValuationSettings() {
    return this.inventoryService.getValuationSettings();
  }

  @Patch('valuation-method')
  @SkipPermissionCheck()
  updateValuationSettings(
    @Body() dto: UpdateValuationMethodDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.inventoryService.updateValuationSettings(
      dto.valuationMethod,
      user.sub,
    );
  }
}
