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
import { AnalyticAccountsService } from './analytic-accounts.service';
import { CreateAnalyticAccountDto } from './dto/create-analytic-account.dto';
import { UpdateAnalyticAccountDto } from './dto/update-analytic-account.dto';
import { FindAnalyticAccountsQueryDto } from './dto/find-analytic-accounts-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';

/** Master Data — Analytic Accounts. Business operations: Create, Update, Archive, Restore, Search. */
@Controller('analytic-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('analytic-accounts')
export class AnalyticAccountsController {
  constructor(
    private readonly analyticAccountsService: AnalyticAccountsService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateAnalyticAccountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.analyticAccountsService.create(dto, user.sub);
  }

  @Get()
  @SkipPermissionCheck()
  findAll(@Query() query: FindAnalyticAccountsQueryDto) {
    return this.analyticAccountsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.analyticAccountsService.findOne(id);
  }

  @Get(':id/activity')
  activity(@Param('id') id: string) {
    return this.analyticAccountsService.activityFor(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAnalyticAccountDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.analyticAccountsService.update(id, dto, user.sub);
  }

  @Post(':id/archive')
  @PermissionAction('delete')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.analyticAccountsService.archive(id, user.sub);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.analyticAccountsService.restore(id, user.sub);
  }
}
