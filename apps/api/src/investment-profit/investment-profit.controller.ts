import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { InvestmentProfitService } from './investment-profit.service';
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

/** Investor Engine Milestone 2, Phase 59/60 — the single API surface for the authoritative Net Profit Engine. */
@Controller('investment-profit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investment-profit')
export class InvestmentProfitController {
  constructor(private readonly profitService: InvestmentProfitService) {}

  @Get('estimate')
  estimate(@Query() query: OpportunityIdQueryDto) {
    return this.profitService.estimate(query.opportunityId);
  }

  @Get()
  findAll(@Query() query: OpportunityIdQueryDto) {
    return this.profitService.findAll(query.opportunityId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.profitService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.profitService.activityFor(id);
  }

  @Post()
  @HttpCode(201)
  @PermissionAction('create')
  calculate(
    @Query() query: OpportunityIdQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.profitService.calculate(query.opportunityId, user.sub);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @PermissionAction('approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.profitService.approve(id, user.sub);
  }
}
