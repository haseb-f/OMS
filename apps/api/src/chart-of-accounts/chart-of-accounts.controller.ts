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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.chartOfAccountsService.findOne(id);
  }

  /** The proposed next code for a child of `:parentId` (Part 14) — read-only, never mutates anything; same `view` permission as the rest of this module (GET's default). */
  @Get(':parentId/next-code')
  nextCode(@Param('parentId') parentId: string) {
    return this.chartOfAccountsService.proposeNextCode(parentId);
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
