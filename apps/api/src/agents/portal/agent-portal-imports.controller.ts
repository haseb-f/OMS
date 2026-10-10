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
import { AgentPortal } from '../../auth/decorators/agent-access.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AgentRequestContext } from '../../auth/guards/jwt-auth.guard';
import {
  AgentPermissionGuard,
  RequireAnyAgentPermission,
} from '../common/agent-permission.guard';
import { CurrentAgent } from '../common/current-agent.decorator';
import {
  IMPORT_FILE_MAX_BYTES,
  ImportWorkspaceService,
} from '../../import-center/import-workspace.service';
import { sendWorkbook } from '../../import-center/send-workbook.util';
import type { ImportActor } from '../../import-center/import-type.interface';
import { CreateImportJobDto } from '../../import-center/dto/create-import-job.dto';
import { SetMappingDto } from '../../import-center/dto/set-mapping.dto';
import { SaveMappingTemplateDto } from '../../import-center/dto/save-mapping-template.dto';
import { UploadGoogleSheetsDto } from '../../import-center/dto/upload-google-sheets.dto';
import { BulkImportRowIdsDto } from '../../import-center/dto/bulk-import-row-ids.dto';
import { RejectImportRowDto } from '../../import-center/dto/reject-import-row.dto';
import { BulkRejectImportRowsDto } from '../../import-center/dto/bulk-reject-import-rows.dto';

const agentActor = (agent: AgentRequestContext): ImportActor => ({
  userId: agent.userId,
  agent,
});

/**
 * R15 (D15-16, spec §7) — `/agent-portal/imports/*`: an agent user imports
 * leads (`agent.leads.import`) or orders (`agent.orders.import`) into their
 * own agent, through the same workspace as the company Import Center
 * (`ImportWorkspaceService`: per-type permission, own jobs only, the agent's
 * own catalogue, `AgentOrdersService` rules). The agent always comes from the
 * verified token (`@CurrentAgent()`) — never from the file, a route param, a
 * query or a body field. Company jobs are never visible here.
 */
@Controller('agent-portal/imports')
@AgentPortal()
@UseGuards(JwtAuthGuard, AgentPermissionGuard)
@RequireAnyAgentPermission('agent.leads.import', 'agent.orders.import')
export class AgentPortalImportsController {
  constructor(private readonly workspace: ImportWorkspaceService) {}

  @Get('types')
  types(@CurrentAgent() agent: AgentRequestContext) {
    return this.workspace.types(agentActor(agent));
  }

  @Get('types/:type/sales-template')
  async template(
    @Param('type') type: string,
    @CurrentAgent() agent: AgentRequestContext,
    @Res() res: Response,
    @Query('lang') lang?: string,
  ) {
    sendWorkbook(
      res,
      await this.workspace.salesTemplate(
        type,
        agentActor(agent),
        lang === 'en' ? 'en' : 'ar',
      ),
    );
  }

  @Get('google-sheets/connections')
  sheetConnections(@CurrentAgent() agent: AgentRequestContext) {
    return this.workspace.sheetConnections(agentActor(agent));
  }

  @Delete('google-sheets/connections/:id')
  @HttpCode(200)
  revokeSheetConnection(
    @Param('id') id: string,
    @CurrentAgent() agent: AgentRequestContext,
  ) {
    return this.workspace.revokeSheetConnection(id, agentActor(agent));
  }

  @Post('jobs')
  create(
    @Body() dto: CreateImportJobDto,
    @CurrentAgent() agent: AgentRequestContext,
  ) {
    return this.workspace.create(dto.importType, agentActor(agent));
  }

  @Get('jobs')
  list(
    @CurrentAgent() agent: AgentRequestContext,
    @Query('importType') importType?: string,
  ) {
    return this.workspace.list(agentActor(agent), importType);
  }

  @Get('jobs/mapping-templates/:importType')
  listMappingTemplates(
    @Param('importType') importType: string,
    @CurrentAgent() agent: AgentRequestContext,
  ) {
    return this.workspace.listMappingTemplates(importType, agentActor(agent));
  }

  @Post('jobs/mapping-templates')
  saveMappingTemplate(
    @Body() dto: SaveMappingTemplateDto,
    @CurrentAgent() agent: AgentRequestContext,
  ) {
    return this.workspace.saveMappingTemplate(dto, agentActor(agent));
  }

  @Delete('jobs/mapping-templates/:id')
  @HttpCode(200)
  removeMappingTemplate(
    @Param('id') id: string,
    @CurrentAgent() agent: AgentRequestContext,
  ) {
    return this.workspace.removeMappingTemplate(id, agentActor(agent));
  }

  @Get('jobs/:id')
  get(@Param('id') id: string, @CurrentAgent() agent: AgentRequestContext) {
    return this.workspace.get(id, agentActor(agent));
  }

  @Post('jobs/:id/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: IMPORT_FILE_MAX_BYTES },
      // Browsers send the file name as UTF-8; busboy's default (latin1) turns an
      // Arabic name into mojibake in the import history.
      defParamCharset: 'utf8',
    }),
  )
  upload(
    @Param('id') id: string,
    @CurrentAgent() agent: AgentRequestContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.workspace.upload(id, agentActor(agent), file);
  }

  @Post('jobs/:id/google-sheets')
  @HttpCode(200)
  uploadFromGoogleSheets(
    @Param('id') id: string,
    @Body() dto: UploadGoogleSheetsDto,
    @CurrentAgent() agent: AgentRequestContext,
  ) {
    return this.workspace.uploadFromGoogleSheets(
      id,
      agentActor(agent),
      dto.url,
    );
  }

  @Post('jobs/:id/refresh')
  @HttpCode(200)
  refresh(@Param('id') id: string, @CurrentAgent() agent: AgentRequestContext) {
    return this.workspace.refresh(id, agentActor(agent));
  }

  @Get('jobs/:id/preview')
  preview(
    @Param('id') id: string,
    @CurrentAgent() agent: AgentRequestContext,
    @Query('limit') limit?: string,
  ) {
    return this.workspace.preview(
      id,
      agentActor(agent),
      limit ? Number(limit) : undefined,
    );
  }

  @Post('jobs/:id/mapping')
  @HttpCode(200)
  setMapping(
    @Param('id') id: string,
    @Body() dto: SetMappingDto,
    @CurrentAgent() agent: AgentRequestContext,
  ) {
    return this.workspace.setMapping(id, agentActor(agent), dto);
  }

  @Post('jobs/:id/validate')
  @HttpCode(200)
  validate(
    @Param('id') id: string,
    @CurrentAgent() agent: AgentRequestContext,
  ) {
    return this.workspace.validate(id, agentActor(agent));
  }

  @Post('jobs/:id/run')
  @HttpCode(200)
  run(@Param('id') id: string, @CurrentAgent() agent: AgentRequestContext) {
    return this.workspace.run(id, agentActor(agent));
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @CurrentAgent() agent: AgentRequestContext) {
    return this.workspace.cancel(id, agentActor(agent));
  }

  @Get('jobs/:id/rows')
  rows(
    @Param('id') id: string,
    @CurrentAgent() agent: AgentRequestContext,
    @Query('status') status?: 'NEEDS_REVIEW' | 'REJECTED',
  ) {
    return this.workspace.rows(id, agentActor(agent), status);
  }

  @Post('jobs/:id/rows/bulk-confirm')
  @HttpCode(200)
  confirmRows(
    @Param('id') id: string,
    @Body() dto: BulkImportRowIdsDto,
    @CurrentAgent() agent: AgentRequestContext,
  ) {
    return this.workspace.confirmRows(id, dto.rowIds, agentActor(agent));
  }

  @Post('jobs/:id/rows/bulk-reject')
  @HttpCode(200)
  rejectRows(
    @Param('id') id: string,
    @Body() dto: BulkRejectImportRowsDto,
    @CurrentAgent() agent: AgentRequestContext,
  ) {
    return this.workspace.rejectRows(id, dto.rowIds, agentActor(agent), dto);
  }

  @Post('jobs/:id/rows/:rowId/confirm')
  @HttpCode(200)
  confirmRow(
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @CurrentAgent() agent: AgentRequestContext,
  ) {
    return this.workspace.confirmRow(id, rowId, agentActor(agent));
  }

  @Post('jobs/:id/rows/:rowId/reject')
  @HttpCode(200)
  rejectRow(
    @Param('id') id: string,
    @Param('rowId') rowId: string,
    @Body() dto: RejectImportRowDto,
    @CurrentAgent() agent: AgentRequestContext,
  ) {
    return this.workspace.rejectRow(id, rowId, agentActor(agent), dto);
  }

  @Get('jobs/:id/errors/export')
  async exportErrors(
    @Param('id') id: string,
    @CurrentAgent() agent: AgentRequestContext,
    @Res() res: Response,
  ) {
    const csv = await this.workspace.exportErrors(id, agentActor(agent));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="import-errors-${id}.csv"`,
    );
    res.send(csv);
  }
}
