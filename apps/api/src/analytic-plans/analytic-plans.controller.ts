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
import { AnalyticPlansService } from './analytic-plans.service';
import { CreateAnalyticPlanDto } from './dto/create-analytic-plan.dto';
import { UpdateAnalyticPlanDto } from './dto/update-analytic-plan.dto';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Master Data — Analytic Plans. Business operations: Create, Update, Archive, Restore, Search. */
@Controller('analytic-plans')
@UseGuards(JwtAuthGuard)
export class AnalyticPlansController {
  constructor(private readonly analyticPlansService: AnalyticPlansService) {}

  @Post()
  create(@Body() dto: CreateAnalyticPlanDto, @CurrentUser() user: JwtPayload) {
    return this.analyticPlansService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.analyticPlansService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.analyticPlansService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.analyticPlansService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAnalyticPlanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.analyticPlansService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.analyticPlansService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.analyticPlansService.restore(id, user.sub);
  }
}
