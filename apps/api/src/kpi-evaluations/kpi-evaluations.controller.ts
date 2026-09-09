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
import { KpiEvaluationsService } from './kpi-evaluations.service';
import { StartKpiEvaluationDto } from './dto/start-kpi-evaluation.dto';
import { ScoreKpiItemDto } from './dto/score-kpi-item.dto';
import { ReopenKpiEvaluationDto } from './dto/reopen-kpi-evaluation.dto';
import { KpiEvaluationsQueryDto } from './dto/kpi-evaluations-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Part M-P — Monthly KPI Evaluations: start, score, submit, approve, reopen. */
@Controller('kpi-evaluations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('kpi-evaluations')
export class KpiEvaluationsController {
  constructor(private readonly service: KpiEvaluationsService) {}

  @Post()
  @PermissionAction('edit')
  start(@Body() dto: StartKpiEvaluationDto, @CurrentUser() user: JwtPayload) {
    return this.service.start(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: KpiEvaluationsQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/audit-log')
  auditLog(@Param('id') id: string) {
    return this.service.auditLog(id);
  }

  @Patch(':id/items/:itemId')
  @PermissionAction('edit')
  scoreItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ScoreKpiItemDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.scoreItem(id, itemId, dto, user.sub);
  }

  @Post(':id/recompute-auto-metrics')
  @PermissionAction('edit')
  recomputeAutoMetrics(@Param('id') id: string) {
    return this.service.computeAutoMetrics(id);
  }

  @Post(':id/submit')
  @PermissionAction('confirm')
  submit(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.submitByManager(id, user.sub);
  }

  @Post(':id/approve')
  @PermissionAction('approve')
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.approveByHr(id, user.sub);
  }

  @Post(':id/reopen')
  @PermissionAction('manage')
  reopen(
    @Param('id') id: string,
    @Body() dto: ReopenKpiEvaluationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.reopen(id, dto, user.sub);
  }
}
