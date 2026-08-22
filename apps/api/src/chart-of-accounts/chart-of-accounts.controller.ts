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
import { AccountType } from '@prisma/client';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CreateChartOfAccountDto } from './dto/create-chart-of-account.dto';
import { UpdateChartOfAccountDto } from './dto/update-chart-of-account.dto';
import { FindChartOfAccountsQueryDto } from './dto/find-chart-of-accounts-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { ResetChartToFiveRootsDto } from './dto/reset-chart-to-five-roots.dto';
import { BulkIdsDto } from '../master-data/dto/bulk-ids.dto';

/** Master Data — Chart of Accounts. Business operations: Create, Update, Archive, Restore, Search. */
@Controller('chart-of-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('chart-of-accounts')
export class ChartOfAccountsController {
  constructor(
    private readonly chartOfAccountsService: ChartOfAccountsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateChartOfAccountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chartOfAccountsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindChartOfAccountsQueryDto) {
    return this.chartOfAccountsService.findAll(query);
  }

  @Get('export')
  @PermissionAction('export')
  exportRows() {
    return this.chartOfAccountsService.exportRows();
  }

  /**
   * Read-only inventory for resetting the chart to roots 1–5.
   * Never mutates. Declared before `:id` routes.
   */
  @Get('reset-to-five-roots/preview')
  @PermissionAction('manage')
  previewResetToFiveRoots() {
    return this.chartOfAccountsService.previewResetToFiveRoots();
  }

  /**
   * Dry-run by default. Apply only when body.confirm is exactly
   * RESET_CHART_TO_FIVE_ROOTS and dryRun is false. Refuses when any
   * non-root account has journal/config dependencies.
   */
  @Post('reset-to-five-roots')
  @PermissionAction('manage')
  resetToFiveRoots(@Body() dto: ResetChartToFiveRootsDto) {
    return this.chartOfAccountsService.resetToFiveRoots({
      confirm: dto.confirm,
      dryRun: dto.dryRun,
    });
  }

  /** Soft-archive eligible unused leaf accounts. Roots 1–5 always blocked. */
  @Post('bulk-archive')
  @PermissionAction('delete')
  bulkArchive(@Body() dto: BulkIdsDto, @CurrentUser() user: JwtPayload) {
    return this.chartOfAccountsService.bulkArchive(dto.ids, user.sub);
  }

  /**
   * The proposed next code for a NEW ROOT account of `?accountType=` (Part
   * 14) — read-only, never mutates anything. Declared before `:id` so a
   * request to `/chart-of-accounts/next-code` never gets swallowed by the
   * `findOne(':id')` route (NestJS matches static routes before dynamic
   * ones only if they're registered first).
   */
  @Get('next-code')
  nextRootCode(@Query('accountType') accountType: AccountType) {
    return this.chartOfAccountsService.proposeNextCode(null, accountType);
  }

  @Post('repair-hierarchy')
  @PermissionAction('edit')
  repairHierarchy() {
    return this.chartOfAccountsService.repairHierarchy();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.chartOfAccountsService.findOne(id);
  }

  /** The proposed next code for a child of `:parentId` (Part 14) — read-only, never mutates anything; same `view` permission as the rest of this module (GET's default). */
  @Get(':parentId/next-code')
  nextCode(@Param('parentId') parentId: string) {
    return this.chartOfAccountsService.proposeNextCode(parentId);
  }

  /** Every descendant id of `:id` — the frontend's Parent Account picker uses this to exclude a subtree from its own selectable options (Part 8/10). */
  @Get(':id/descendants')
  descendants(@Param('id') id: string) {
    return this.chartOfAccountsService.descendantIds(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.chartOfAccountsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateChartOfAccountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chartOfAccountsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.chartOfAccountsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  @SkipPermissionCheck()
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.chartOfAccountsService.restore(id, user.sub);
  }
}
