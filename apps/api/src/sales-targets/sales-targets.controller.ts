import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TargetMetric } from '@prisma/client';
import { SalesTargetsService } from './sales-targets.service';
import { CreateSalesTargetDto } from './dto/create-sales-target.dto';
import { UpdateSalesTargetDto } from './dto/update-sales-target.dto';
import { SalesTargetsQueryDto } from './dto/sales-targets-query.dto';
import { currentPeriod } from '../common/period/period-range.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { SkipPermissionCheck } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Part Q-S — Monthly Sales Targets + Ranking. */
@Controller('sales-targets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('sales-targets')
export class SalesTargetsController {
  constructor(private readonly service: SalesTargetsService) {}

  @Get('ranking')
  ranking(
    @Query('period') period: string | undefined,
    @Query('metric') metric: TargetMetric | undefined,
    @Query('departmentId') departmentId: string | undefined,
    @Query('salesTeamId') salesTeamId: string | undefined,
  ) {
    return this.service.ranking(period ?? currentPeriod(), metric, {
      departmentId,
      salesTeamId,
    });
  }

  /** Part S "ترتيبك #3" — every authenticated employee may see their own rank. */
  @Get('me')
  @SkipPermissionCheck()
  myRanking(
    @CurrentUser() user: JwtPayload,
    @Query('period') period: string | undefined,
    @Query('metric') metric: TargetMetric | undefined,
  ) {
    return this.service.myRanking(user.sub, period ?? currentPeriod(), metric);
  }

  @Post()
  create(@Body() dto: CreateSalesTargetDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: SalesTargetsQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSalesTargetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(id, dto, user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
