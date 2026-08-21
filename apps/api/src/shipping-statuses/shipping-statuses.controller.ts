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
import { ShippingStatusesService } from './shipping-statuses.service';
import { CreateShippingStatusDto } from './dto/create-shipping-status.dto';
import { UpdateShippingStatusDto } from './dto/update-shipping-status.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Master Data — Shipping Statuses. Business operations: Create, Update, Archive, Restore, Search. */
@Controller('shipping-statuses')
@UseGuards(JwtAuthGuard)
export class ShippingStatusesController {
  constructor(
    private readonly shippingStatusesService: ShippingStatusesService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateShippingStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.shippingStatusesService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.shippingStatusesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shippingStatusesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.shippingStatusesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateShippingStatusDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.shippingStatusesService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.shippingStatusesService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.shippingStatusesService.restore(id, user.sub);
  }
}
