import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InvestmentOpportunitiesService } from './investment-opportunities.service';
import { CreateInvestmentOpportunityDto } from './dto/create-investment-opportunity.dto';
import { UpdateInvestmentOpportunityDto } from './dto/update-investment-opportunity.dto';
import { FindInvestmentOpportunitiesQueryDto } from './dto/find-investment-opportunities-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Investor Engine Milestone 1, Phase 5/16/24-27 — the central investment container workspace. */
@Controller('investment-opportunities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('investment-opportunities')
export class InvestmentOpportunitiesController {
  constructor(
    private readonly opportunitiesService: InvestmentOpportunitiesService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateInvestmentOpportunityDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.opportunitiesService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindInvestmentOpportunitiesQueryDto) {
    return this.opportunitiesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.opportunitiesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.opportunitiesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInvestmentOpportunityDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.opportunitiesService.update(id, dto, user.sub);
  }

  @Post(':id/open')
  @HttpCode(200)
  @PermissionAction('manage')
  open(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.opportunitiesService.open(id, user.sub);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @PermissionAction('manage')
  activate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.opportunitiesService.activate(id, user.sub);
  }

  @Post(':id/end')
  @HttpCode(200)
  @PermissionAction('manage')
  end(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.opportunitiesService.end(id, user.sub);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @PermissionAction('cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.opportunitiesService.cancel(id, user.sub);
  }

  /** SETTLED -> CLOSED final archival action (Phase 47) — ENDED -> SETTLED only happens via the Settlement Engine. */
  @Post(':id/close')
  @HttpCode(200)
  @PermissionAction('manage')
  close(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.opportunitiesService.close(id, user.sub);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.opportunitiesService.archive(id, user.sub);
  }
}
