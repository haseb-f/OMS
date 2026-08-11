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
import { FixedAssetsService } from './fixed-assets.service';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Fixed Assets — Create, Update, Archive, Restore, Search (same shape as Cost Centers/Expenses). */
@Controller('fixed-assets')
@UseGuards(JwtAuthGuard)
export class FixedAssetsController {
  constructor(private readonly fixedAssetsService: FixedAssetsService) {}

  @Post()
  create(@Body() dto: CreateFixedAssetDto, @CurrentUser() user: JwtPayload) {
    return this.fixedAssetsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.fixedAssetsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.fixedAssetsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.fixedAssetsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFixedAssetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.fixedAssetsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fixedAssetsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fixedAssetsService.restore(id, user.sub);
  }
}
