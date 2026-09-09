import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CommissionsService } from './commissions.service';
import { CalculateCommissionDto } from './dto/calculate-commission.dto';
import { AdjustCommissionDto } from './dto/adjust-commission.dto';
import { CreateFutureAdjustmentDto } from './dto/create-future-adjustment.dto';
import { CommissionsQueryDto } from './dto/commissions-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Part T-X — Commission calculation review/approval/adjustment. Plan configuration lives in `commission-plans`. */
@Controller('commissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('commissions')
export class CommissionsController {
  constructor(private readonly service: CommissionsService) {}

  @Post('calculate')
  @PermissionAction('view')
  calculate(@Body() dto: CalculateCommissionDto) {
    return this.service.calculate(dto);
  }

  @Get()
  findAll(@Query() query: CommissionsQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/approve')
  @PermissionAction('approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.approve(id, user.sub);
  }

  @Post(':id/adjust')
  @PermissionAction('manage')
  adjust(
    @Param('id') id: string,
    @Body() dto: AdjustCommissionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.adjust(id, dto, user.sub);
  }

  @Post(':id/future-adjustments')
  @PermissionAction('manage')
  createFutureAdjustment(
    @Param('id') id: string,
    @Body() dto: CreateFutureAdjustmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createFutureAdjustment(id, dto, user.sub);
  }
}
