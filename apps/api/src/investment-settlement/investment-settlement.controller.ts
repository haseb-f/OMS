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
import { InvestmentSettlementService } from './investment-settlement.service';
import { StartSettlementDto } from './dto/start-settlement.dto';
import { CompleteSettlementDto } from './dto/complete-settlement.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

class OpportunityIdQueryDto {
  @IsUUID()
  opportunityId!: string;
}

/** Investor Engine Milestone 2, Phases 32-47 — End-Date Settlement Engine. */
@Controller('investment-settlement')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investment-settlement')
export class InvestmentSettlementController {
  constructor(
    private readonly settlementService: InvestmentSettlementService,
  ) {}

  @Get()
  findAll(@Query() query: OpportunityIdQueryDto) {
    return this.settlementService.findAll(query.opportunityId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.settlementService.findOne(id);
  }

  @Get(':id/suggestions')
  suggestions(@Param('id') id: string) {
    return this.settlementService.getSuggestions(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.settlementService.activityFor(id);
  }

  @Post()
  @HttpCode(201)
  @PermissionAction('create')
  start(@Body() dto: StartSettlementDto, @CurrentUser() user: JwtPayload) {
    return this.settlementService.start(dto.opportunityId, user.sub);
  }

  @Post(':id/review')
  @HttpCode(200)
  @PermissionAction('manage')
  moveToReview(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.settlementService.moveToReview(id, user.sub);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @PermissionAction('approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.settlementService.approve(id, user.sub);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @PermissionAction('approve')
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteSettlementDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.settlementService.complete(id, dto, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.settlementService.cancel(id, user.sub);
  }
}
