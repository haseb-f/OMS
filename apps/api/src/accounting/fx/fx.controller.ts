import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import {
  PermissionAction,
  SkipPermissionCheck,
} from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { ExchangeRatesService } from './exchange-rates.service';
import { FxRevaluationService } from './fx-revaluation.service';
import { FxCorrectionService } from './fx-correction.service';
import { FxOverridesService } from './fx-overrides.service';
import { FxSyncService } from './fx-sync.service';
import {
  CheckExchangeRateQueryDto,
  CreateExchangeRateDto,
  CreateFxOverrideDto,
  DeleteFxOverrideDto,
  FxBackfillDto,
  FxOverrideQueryDto,
  ResolveRateQueryDto,
  UpdateFxSyncSettingsDto,
  BulkImportExchangeRatesDto,
  ExchangeRateQueryDto,
  FxCorrectionDto,
  RunFxRevaluationDto,
} from './dto/fx.dto';

@Controller('exchange-rates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('exchange-rates')
export class ExchangeRatesController {
  constructor(
    private readonly exchangeRates: ExchangeRatesService,
    private readonly overrides: FxOverridesService,
    private readonly sync: FxSyncService,
  ) {}

  @Post()
  create(@Body() dto: CreateExchangeRateDto, @CurrentUser() user: JwtPayload) {
    return this.exchangeRates.create(dto, user.sub);
  }

  @Post('bulk-import')
  @PermissionAction('create')
  bulkImport(
    @Body() dto: BulkImportExchangeRatesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.exchangeRates.bulkImport(dto.rows ?? [], user.sub);
  }

  @Get()
  findAll(@Query() query: ExchangeRateQueryDto) {
    return this.exchangeRates.findAll(query);
  }

  /** Read-only "is a rate on record?" probe used before posting any
   *  foreign-currency document — open to every signed-in user who can post
   *  documents, not only exchange-rate administrators. */
  @Get('check')
  @SkipPermissionCheck()
  check(@Query() query: CheckExchangeRateQueryDto) {
    return this.exchangeRates.checkRate(
      query.currencyId,
      query.asOf ? new Date(query.asOf) : new Date(),
    );
  }

  /** Rate lookup tool: the rate a document dated `asOf` would freeze, with
   *  provenance, or the fail-closed reason (never throws for MISSING/STALE). */
  @Get('resolve')
  resolve(@Query() query: ResolveRateQueryDto) {
    return this.exchangeRates.checkRate(query.currencyId, new Date(query.asOf));
  }

  // --- Dated manual overrides (exchange-rates.manage to change) ----------

  @Get('overrides')
  listOverrides(@Query() query: FxOverrideQueryDto) {
    return this.overrides.list(query);
  }

  @Post('overrides')
  @PermissionAction('manage')
  createOverride(
    @Body() dto: CreateFxOverrideDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.overrides.create(dto, user.sub);
  }

  /** Soft delete with a reason (never a hard delete). */
  @Post('overrides/:id/delete')
  @PermissionAction('manage')
  deleteOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteFxOverrideDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.overrides.remove(id, dto, user.sub);
  }

  // --- Automatic official import -----------------------------------------

  @Get('sync/status')
  syncStatus() {
    return this.sync.status();
  }

  @Get('sync/runs')
  syncRuns(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.sync.listRuns(limit ?? 20);
  }

  @Patch('sync/settings')
  @PermissionAction('manage')
  updateSyncSettings(
    @Body() dto: UpdateFxSyncSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sync.updateSettings(dto, user.sub);
  }

  @Post('sync/run')
  @PermissionAction('manage')
  async runSync(@CurrentUser() user: JwtPayload) {
    await this.sync.assertCooldown();
    return this.sync.runNow(user.sub);
  }

  @Post('sync/backfill')
  @PermissionAction('manage')
  async backfill(@Body() dto: FxBackfillDto, @CurrentUser() user: JwtPayload) {
    await this.sync.assertCooldown();
    return this.sync.backfill(dto.days, user.sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.exchangeRates.findOne(id);
  }
}

@Controller('fx-revaluations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('fx-revaluations')
export class FxRevaluationsController {
  constructor(
    private readonly fxRevaluation: FxRevaluationService,
    private readonly fxCorrection: FxCorrectionService,
  ) {}

  @Get()
  findAll() {
    return this.fxRevaluation.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.fxRevaluation.findOne(id);
  }

  @Post('run')
  @PermissionAction('post')
  run(@Body() dto: RunFxRevaluationDto, @CurrentUser() user: JwtPayload) {
    return this.fxRevaluation.run(dto, user.sub);
  }

  /** Audited reverse + re-post of a document posted at a wrong rate. */
  @Post('corrections/:journalEntryId')
  @PermissionAction('post')
  correct(
    @Param('journalEntryId', ParseUUIDPipe) journalEntryId: string,
    @Body() dto: FxCorrectionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.fxCorrection.repost(journalEntryId, dto, user.sub);
  }
}
