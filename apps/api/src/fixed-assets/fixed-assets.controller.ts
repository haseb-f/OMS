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
import {
  CapitalizeFixedAssetDto,
  DisposeFixedAssetDto,
  RunDepreciationDto,
} from './dto/lifecycle.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

@Controller('fixed-assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('fixed-assets')
export class FixedAssetsController {
  constructor(private readonly fixedAssetsService: FixedAssetsService) {}

  @Post()
  create(@Body() dto: CreateFixedAssetDto, @CurrentUser() user: JwtPayload) {
    return this.fixedAssetsService.create(dto, user.sub);
  }

  @Post('depreciation-run')
  @PermissionAction('edit')
  runDepreciation(
    @Body() dto: RunDepreciationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.fixedAssetsService.runDepreciation(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
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

  @Post(':id/capitalize')
  @PermissionAction('edit')
  capitalize(
    @Param('id') id: string,
    @Body() dto: CapitalizeFixedAssetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.fixedAssetsService.capitalize(id, dto, user.sub);
  }

  @Post(':id/dispose')
  @PermissionAction('edit')
  dispose(
    @Param('id') id: string,
    @Body() dto: DisposeFixedAssetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.fixedAssetsService.dispose(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fixedAssetsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.fixedAssetsService.restore(id, user.sub);
  }
}
