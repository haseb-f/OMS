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
import { UnitConversionsService } from './unit-conversions.service';
import { CreateUnitConversionDto } from './dto/create-unit-conversion.dto';
import { UpdateUnitConversionDto } from './dto/update-unit-conversion.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Master Data — Unit Conversions. Business operations: Create, Update, Archive, Restore, Search. */
@Controller('unit-conversions')
@UseGuards(JwtAuthGuard)
export class UnitConversionsController {
  constructor(
    private readonly unitConversionsService: UnitConversionsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateUnitConversionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.unitConversionsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.unitConversionsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.unitConversionsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.unitConversionsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUnitConversionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.unitConversionsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.unitConversionsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.unitConversionsService.restore(id, user.sub);
  }
}
