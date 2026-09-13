import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { ProfitDistributionsService } from './profit-distributions.service';
import { CreateProfitDistributionDto } from './dto/create-profit-distribution.dto';
import { FindProfitDistributionsQueryDto } from './dto/find-profit-distributions-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

class ProfitCalculationIdQueryDto {
  @IsUUID()
  profitCalculationId!: string;
}

class OpportunityIdQueryDto {
  @IsUUID()
  opportunityId!: string;
}

/** Investor Engine Milestone 3, Phases 3-7/21/27/38-40 — the single API surface for Profit Distribution runs. */
@Controller('investment-distributions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investment-distributions')
export class ProfitDistributionsController {
  constructor(
    private readonly distributionsService: ProfitDistributionsService,
  ) {}

  @Get('preview')
  preview(@Query() query: ProfitCalculationIdQueryDto) {
    return this.distributionsService.preview(query.profitCalculationId);
  }

  @Get('opportunity-summary')
  opportunitySummary(@Query() query: OpportunityIdQueryDto) {
    return this.distributionsService.opportunitySummary(query.opportunityId);
  }

  @Get()
  findAll(@Query() query: FindProfitDistributionsQueryDto) {
    return this.distributionsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.distributionsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.distributionsService.activityFor(id);
  }

  @Post()
  @HttpCode(201)
  create(
    @Body() dto: CreateProfitDistributionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.distributionsService.create(dto, user.sub);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @PermissionAction('approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.distributionsService.approve(id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.distributionsService.cancel(id, user.sub);
  }
}
