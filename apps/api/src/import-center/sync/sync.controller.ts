import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/guards/jwt-auth.guard';
import { SyncSourceConfigService } from './sync-source-config.service';
import { SyncOrchestratorService } from './sync-orchestrator.service';
import { ListSheetService } from '../list-sheet/list-sheet.service';
import { CreateSyncSourceDto } from './dto/create-sync-source.dto';
import { UpdateSyncSourceDto } from './dto/update-sync-source.dto';
import { CommitSyncDto } from './dto/commit-sync.dto';
import { PreviewSyncDto } from './dto/preview-sync.dto';
import { ClearStoreOrderSyncResultsDto } from './dto/clear-store-order-sync-results.dto';
import { RejectImportRowDto } from '../dto/reject-import-row.dto';

/**
 * Data Synchronization (مزامنة البيانات) — the single backend surface every
 * "Sync" button (Import Center, Leads, Store Orders, Cash Flow pages) calls.
 * Source configuration (`import-center.manage`) is a separate, coarser
 * privilege from actually running a sync (`import-center.sync`) — a user
 * who can trigger a sync doesn't automatically get to repoint it at a
 * different spreadsheet, and vice versa.
 */
@Controller('import-center/sync')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('import-center')
export class SyncController {
  constructor(
    private readonly sources: SyncSourceConfigService,
    private readonly orchestrator: SyncOrchestratorService,
    private readonly listSheet: ListSheetService,
  ) {}

  @Get('sources')
  @PermissionAction('view')
  findAll(@Query('sourceType') sourceType?: string) {
    return this.sources.findAll(sourceType);
  }

  @Get('sources/:id')
  @PermissionAction('view')
  findOne(@Param('id') id: string) {
    return this.sources.findOne(id);
  }

  @Post('sources')
  @PermissionAction('import')
  create(@Body() dto: CreateSyncSourceDto, @CurrentUser() user: JwtPayload) {
    return this.sources.create(dto, user.sub);
  }

  @Patch('sources/:id')
  @PermissionAction('import')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSyncSourceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sources.update(id, dto, user.sub);
  }

  @Delete('sources/:id')
  @PermissionAction('import')
  archive(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.sources.archive(id, user.sub);
  }

  /** "مزامنة البيانات" step 1 — fetch + validate; Store Orders also writes row-level errors back to the sheet. */
  @Post('sources/:id/preview')
  @PermissionAction('sync')
  preview(
    @Param('id') id: string,
    @Body() dto: PreviewSyncDto = {},
    @CurrentUser() user: JwtPayload,
  ) {
    return this.orchestrator.preview(id, user.sub, {
      retryRowNumbers: dto.retryRowNumbers,
      retryAllFailed: dto.retryAllFailed,
      runAs: dto.runAs,
    });
  }

  /** "مزامنة البيانات" step 2 — requires an explicit `jobId` from a just-run preview. */
  @Post('sources/:id/commit')
  @PermissionAction('sync')
  commit(
    @Param('id') id: string,
    @Body() dto: CommitSyncDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.orchestrator.commit(id, dto.jobId, user.sub, {
      acceptRowNumbers: dto.acceptRowNumbers,
      rejectRowNumbers: dto.rejectRowNumbers,
      runAs: dto.runAs,
    });
  }

  /** "قبول الطلب" on a sync-originated Needs Review row — same operation the generic Import Center Needs Review screen calls, plus sheet write-back. */
  @Post('jobs/:jobId/rows/:rowId/confirm')
  @PermissionAction('sync')
  confirmRow(
    @Param('jobId') jobId: string,
    @Param('rowId') rowId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.orchestrator.confirmRow(jobId, rowId, user.sub);
  }

  /** "رفض الطلب" on a sync-originated Needs Review row. */
  @Post('jobs/:jobId/rows/:rowId/reject')
  @PermissionAction('sync')
  rejectRow(
    @Param('jobId') jobId: string,
    @Param('rowId') rowId: string,
    @Body() dto: RejectImportRowDto,
  ) {
    return this.orchestrator.rejectRow(jobId, rowId, dto);
  }

  /** Clears Q:R:S only for selected Store Orders sheet rows (stale System Order ID recovery). */
  @Post('sources/:id/clear-result-columns')
  @PermissionAction('sync')
  clearStoreOrderResultColumns(
    @Param('id') id: string,
    @Body() dto: ClearStoreOrderSyncResultsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.orchestrator.clearStoreOrderSyncResults(
      id,
      dto.rowNumbers,
      user.sub,
    );
  }

  /**
   * OMS → official Google List Sheet. Publishes current master/reference
   * display values; never imports from the sheet. Uses `import-center.sync`
   * like the four inbound Sync buttons.
   */
  @Get('list-sheet')
  @PermissionAction('sync')
  listSheetStatus() {
    return this.listSheet.status();
  }

  @Post('list-sheet')
  @HttpCode(200)
  @PermissionAction('sync')
  publishListSheet() {
    return this.listSheet.publish();
  }
}
