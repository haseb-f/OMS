import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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

/** Business operations only — no generic CRUD for inventory movements. */
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('opening-balance')
  openingBalance(@Body() dto: OpeningBalanceDto) {
    return this.inventoryService.openingBalance(dto);
  }

  @Post('adjustment')
  adjustment(@Body() dto: AdjustmentDto) {
    return this.inventoryService.adjustment(dto);
  }

  @Post('transfer')
  transfer(@Body() dto: TransferDto) {
    return this.inventoryService.transfer(dto);
  }

  @Post('damage')
  damage(@Body() dto: DamageDto) {
    return this.inventoryService.damage(dto);
  }

  @Post('expired')
  expired(@Body() dto: ExpiredDto) {
    return this.inventoryService.expired(dto);
  }

  @Post('reserve')
  reserve(@Body() dto: ReserveDto) {
    return this.inventoryService.reserve(dto);
  }

  @Post('release')
  release(@Body() dto: ReleaseDto) {
    return this.inventoryService.release(dto);
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
}
