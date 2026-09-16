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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { MasterDataQueryDto } from '../master-data/dto/master-data-query.dto';
import { CostAllocationRulesService } from './cost-allocation-rules.service';
import { CostAllocationRunsService } from './cost-allocation-runs.service';
import { CreateCostAllocationRuleDto } from './dto/create-cost-allocation-rule.dto';
import { UpdateCostAllocationRuleDto } from './dto/update-cost-allocation-rule.dto';
import { CreateCostAllocationRunDto } from './dto/create-cost-allocation-run.dto';

/** M4 (Cost Module completion) — Master Data CRUD for the Rule + nested Run creation/listing. */
@Controller('cost-allocation-rules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('cost-allocation-rules')
export class CostAllocationRulesController {
  constructor(
    private readonly rulesService: CostAllocationRulesService,
    private readonly runsService: CostAllocationRunsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateCostAllocationRuleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rulesService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: MasterDataQueryDto) {
    return this.rulesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.rulesService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.rulesService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCostAllocationRuleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rulesService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.rulesService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.rulesService.restore(id, user.sub);
  }

  @Get(':id/runs')
  @PermissionAction('run')
  listRuns(@Param('id') ruleId: string) {
    return this.runsService.listRuns(ruleId);
  }

  @Post(':id/runs')
  @PermissionAction('run')
  createRun(
    @Param('id') ruleId: string,
    @Body() dto: CreateCostAllocationRunDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.runsService.createRun(ruleId, dto, user.sub);
  }
}

/** Run-level actions that aren't scoped under a specific Rule id in their URL. */
@Controller('cost-allocation-runs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('cost-allocation-rules')
export class CostAllocationRunsController {
  constructor(private readonly runsService: CostAllocationRunsService) {}

  @Get(':id')
  @PermissionAction('run')
  getRun(@Param('id') id: string) {
    return this.runsService.getRun(id);
  }

  @Post(':id/post')
  @PermissionAction('post')
  postRun(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.runsService.postRun(id, user.sub);
  }

  @Post(':id/cancel')
  @PermissionAction('edit')
  cancelRun(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.runsService.cancelRun(id, user.sub);
  }
}
