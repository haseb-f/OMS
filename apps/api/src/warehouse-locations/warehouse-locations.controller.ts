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
import { WarehouseLocationsService } from './warehouse-locations.service';
import { CreateWarehouseLocationDto } from './dto/create-warehouse-location.dto';
import { UpdateWarehouseLocationDto } from './dto/update-warehouse-location.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Master Data — Warehouse Locations. Business operations: Create, Update, Archive, Restore, Search, plus a per-warehouse tree fetch. */
@Controller('warehouse-locations')
@UseGuards(JwtAuthGuard)
export class WarehouseLocationsController {
  constructor(
    private readonly warehouseLocationsService: WarehouseLocationsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateWarehouseLocationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseLocationsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.warehouseLocationsService.findAll(query);
  }

  @Get('by-warehouse/:warehouseId')
  findByWarehouse(@Param('warehouseId') warehouseId: string) {
    return this.warehouseLocationsService.findByWarehouse(warehouseId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.warehouseLocationsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.warehouseLocationsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseLocationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.warehouseLocationsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.warehouseLocationsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.warehouseLocationsService.restore(id, user.sub);
  }
}
