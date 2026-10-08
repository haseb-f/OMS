import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import {
  IMPORT_FILE_MAX_BYTES,
  ImportWorkspaceService,
} from './import-workspace.service';
import type { ImportActor } from './import-type.interface';
import { CreateImportJobDto } from './dto/create-import-job.dto';
import { SetMappingDto } from './dto/set-mapping.dto';
import { SaveMappingTemplateDto } from './dto/save-mapping-template.dto';
import { UploadGoogleSheetsDto } from './dto/upload-google-sheets.dto';
import { BulkImportRowIdsDto } from './dto/bulk-import-row-ids.dto';
import { RejectImportRowDto } from './dto/reject-import-row.dto';
import { BulkRejectImportRowsDto } from './dto/bulk-reject-import-rows.dto';

const companyActor = (user: JwtPayload): ImportActor => ({ userId: user.sub });

/**
 * Business operations: Create Draft, Upload, Preview, Set Mapping, Run,
 * Cancel, Errors Export — for company users. R15 (D15-16): every route is
 * checked by `ImportWorkspaceService` — the type's own import permission
 * (e.g. `crm.leads.import`, `store-orders.import`; `import-center.manage` for
 * administrator types and as the catch-all) and the job's owner (creator, or
 * an `import-center.manage` holder; never an agent's job). No Import Center
 * role is needed to import leads or store orders.
 */
@Controller('import-center/jobs')
@UseGuards(JwtAuthGuard)
export class ImportJobsController {
  constructor(private readonly workspace: ImportWorkspaceService) {}

  @Post()
  create(@Body() dto: CreateImportJobDto, @CurrentUser() user: JwtPayload) {
    return this.workspace.create(dto.importType, companyActor(user));
  }

  /** "My imports" — the caller's own jobs (every company job for `import-center.manage`). */
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('importType') importType?: string,
  ) {
    return this.workspace.list(companyActor(user), importType);
  }

  @Get('mapping-templates/:importType')
  listMappingTemplates(
    @Param('importType') importType: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspace.listMappingTemplates(importType, companyActor(user));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.workspace.get(id, companyActor(user));
  }

  @Post(':id/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: IMPORT_FILE_MAX_BYTES },
    }),
  )
  upload(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.workspace.upload(id, companyActor(user), file);
  }

  /** Connects the private sheet to the importer (D15-17) and reads it with the service account. */
  @Post(':id/google-sheets')
  @HttpCode(200)
  uploadFromGoogleSheets(
    @Param('id') id: string,
    @Body() dto: UploadGoogleSheetsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspace.uploadFromGoogleSheets(
      id,
      companyActor(user),
      dto.url,
    );
  }

  /** "Manual Refresh" — re-reads the same connected Google Sheet. */
  @Post(':id/refresh')
  @HttpCode(200)
  refresh(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.workspace.refresh(id, companyActor(user));
  }

  @Get(':id/preview')
  preview(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
  ) {
    return this.workspace.preview(
      id,
      companyActor(user),
      limit ? Number(limit) : undefined,
    );
  }

  @Post(':id/mapping')
  @HttpCode(200)
  setMapping(
    @Param('id') id: string,
    @Body() dto: SetMappingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspace.setMapping(id, companyActor(user), dto);
  }

  /** Preview: the same checks as the run, nothing written; never changes the job's status. */
  @Post(':id/validate')
  @HttpCode(200)
  validate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.workspace.validate(id, companyActor(user));
  }

  @Post(':id/run')
  @HttpCode(200)
  run(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.workspace.run(id, companyActor(user));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.workspace.cancel(id, companyActor(user));
  }

  /** Lists a job's needs-review rows — `?status=NEEDS_REVIEW` (default view) or `?status=REJECTED` (kept, with their reason, for the review/report UI). */
  @Get(':id/rows')
  rows(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: 'NEEDS_REVIEW' | 'REJECTED',
  ) {
    return this.workspace.rows(id, companyActor(user), status);
  }

  /** Confirms one needs-review row (e.g. "same customer, new order") — writes it for real. */
  @Post(':id/rows/:rowId/confirm')
  @HttpCode(200)
  confirmRow(
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspace.confirmRow(id, rowId, companyActor(user));
  }

  /** Rejects one needs-review row — a reason is required, kept (never deleted) so it stays visible in the review UI. */
  @Post(':id/rows/:rowId/reject')
  @HttpCode(200)
  rejectRow(
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @Body() dto: RejectImportRowDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspace.rejectRow(id, rowId, companyActor(user), dto);
  }

  @Post(':id/rows/bulk-confirm')
  @HttpCode(200)
  confirmRows(
    @Param('id') id: string,
    @Body() dto: BulkImportRowIdsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspace.confirmRows(id, dto.rowIds, companyActor(user));
  }

  @Post(':id/rows/bulk-reject')
  @HttpCode(200)
  rejectRows(
    @Param('id') id: string,
    @Body() dto: BulkRejectImportRowsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspace.rejectRows(id, dto.rowIds, companyActor(user), dto);
  }

  @Get(':id/errors/export')
  async exportErrors(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const csv = await this.workspace.exportErrors(id, companyActor(user));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="import-errors-${id}.csv"`,
    );
    res.send(csv);
  }

  @Post('mapping-templates')
  saveMappingTemplate(
    @Body() dto: SaveMappingTemplateDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspace.saveMappingTemplate(dto, companyActor(user));
  }

  @Delete('mapping-templates/:id')
  @HttpCode(200)
  removeMappingTemplate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspace.removeMappingTemplate(id, companyActor(user));
  }
}
