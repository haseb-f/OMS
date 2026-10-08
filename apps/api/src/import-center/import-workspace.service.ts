import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ImportJobsService } from './import-jobs.service';
import { ImportAccessService } from './import-access.service';
import { ImportMappingTemplatesService } from './import-mapping-templates.service';
import { ImportTemplateService } from './import-template.service';
import { ImportSheetConnectionsService } from './sheet-connections/import-sheet-connections.service';
import { ImportCatalogService } from './sales-import/import-catalog.service';
import {
  importAudience,
  type ImportActor,
  type ImportTypeHandler,
} from './import-type.interface';
import type { SetMappingDto } from './dto/set-mapping.dto';
import type { RejectImportRowDto } from './dto/reject-import-row.dto';
import type { SaveMappingTemplateDto } from './dto/save-mapping-template.dto';
import type { ImportRowResult } from './import-type.interface';

/** Upload limit of one import file (Excel / CSV). */
export const IMPORT_FILE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * R15 (D15-16) — every one-time import operation as an actor (company user
 * or agent user) may run it: the type permission, then the job's owner
 * scope, are checked here before the engine (`ImportJobsService`) is called —
 * so the company Import Center endpoints and the agent portal endpoints share
 * one implementation and can never drift apart.
 */
@Injectable()
export class ImportWorkspaceService {
  constructor(
    private readonly jobs: ImportJobsService,
    private readonly access: ImportAccessService,
    private readonly mappingTemplates: ImportMappingTemplatesService,
    private readonly templates: ImportTemplateService,
    private readonly sheets: ImportSheetConnectionsService,
    private readonly catalog: ImportCatalogService,
  ) {}

  /**
   * The types the actor may import (or, for the Import Center dashboard,
   * every type — `canImport` tells which), with the sales columns of the
   * actor's audience.
   */
  async types(actor: ImportActor, handlers?: ImportTypeHandler[]) {
    const audience = importAudience(actor);
    const listed = handlers ?? (await this.access.importableTypes(actor));
    return Promise.all(
      listed.map(async (handler) => ({
        type: handler.type,
        labelKey: handler.labelKey,
        descriptionKey: handler.descriptionKey,
        fields: handler.fields,
        isAvailable: handler.isAvailable,
        canImport: handlers
          ? await this.access.canImport(handler, actor)
          : true,
        salesFields: handler.salesTemplateFields?.[audience] ?? null,
      })),
    );
  }

  async create(importType: string, actor: ImportActor) {
    await this.access.assertCanImport(importType, actor);
    return this.jobs.create({ importType }, actor.userId, actor.agent?.agentId);
  }

  async list(actor: ImportActor, importType?: string) {
    return this.jobs.findAll(await this.access.jobsWhere(actor, importType));
  }

  async get(id: string, actor: ImportActor) {
    await this.access.assertJob(id, actor);
    return this.jobs.findOne(id);
  }

  async upload(
    id: string,
    actor: ImportActor,
    file: Express.Multer.File | undefined,
  ) {
    await this.access.assertJob(id, actor);
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }
    // .xlsx is a binary (zip) format — base64, never utf-8, or the bytes get corrupted. .csv stays plain text.
    const isExcel = file.originalname.toLowerCase().endsWith('.xlsx');
    return this.jobs.upload(
      id,
      file.originalname,
      isExcel ? file.buffer.toString('base64') : file.buffer.toString('utf-8'),
    );
  }

  async uploadFromGoogleSheets(id: string, actor: ImportActor, url: string) {
    await this.access.assertJob(id, actor);
    return this.jobs.uploadFromGoogleSheets(id, url, actor);
  }

  async refresh(id: string, actor: ImportActor) {
    await this.access.assertJob(id, actor);
    return this.jobs.refresh(id, actor);
  }

  async preview(id: string, actor: ImportActor, limit?: number) {
    await this.access.assertJob(id, actor);
    return this.jobs.preview(id, limit);
  }

  async setMapping(id: string, actor: ImportActor, dto: SetMappingDto) {
    await this.access.assertJob(id, actor);
    return this.jobs.setMapping(id, dto);
  }

  async validate(id: string, actor: ImportActor) {
    await this.access.assertJob(id, actor);
    return this.jobs.validate(id, actor.userId, { actor });
  }

  /** The run's job and summary — never the per-row record ids (sync write-back only). */
  async run(id: string, actor: ImportActor) {
    await this.access.assertJob(id, actor);
    const job: Partial<Awaited<ReturnType<ImportJobsService['run']>>> =
      await this.jobs.run(id, actor.userId, { actor });
    delete job.successRows;
    return job;
  }

  async cancel(id: string, actor: ImportActor) {
    await this.access.assertJob(id, actor);
    return this.jobs.cancel(id);
  }

  async rows(
    id: string,
    actor: ImportActor,
    status?: 'NEEDS_REVIEW' | 'REJECTED',
  ) {
    await this.access.assertJob(id, actor);
    return this.jobs.rows(id, status);
  }

  async confirmRow(id: string, rowId: string, actor: ImportActor) {
    await this.access.assertJob(id, actor);
    return confirmation(
      rowId,
      await this.jobs.confirmRow(id, rowId, actor.userId, actor),
    );
  }

  async confirmRows(id: string, rowIds: string[], actor: ImportActor) {
    await this.access.assertJob(id, actor);
    return this.jobs.confirmRows(id, rowIds, actor.userId, actor);
  }

  async rejectRow(
    id: string,
    rowId: string,
    actor: ImportActor,
    dto: RejectImportRowDto,
  ) {
    await this.access.assertJob(id, actor);
    return this.jobs.rejectRow(id, rowId, dto);
  }

  async rejectRows(
    id: string,
    rowIds: string[],
    actor: ImportActor,
    dto: RejectImportRowDto,
  ) {
    await this.access.assertJob(id, actor);
    return this.jobs.rejectRows(id, rowIds, dto);
  }

  async exportErrors(id: string, actor: ImportActor) {
    await this.access.assertJob(id, actor);
    return this.jobs.exportErrorsCsv(id);
  }

  async listMappingTemplates(importType: string, actor: ImportActor) {
    await this.access.assertCanImport(importType, actor);
    return this.mappingTemplates.findAll(importType, actor);
  }

  async saveMappingTemplate(dto: SaveMappingTemplateDto, actor: ImportActor) {
    await this.access.assertCanImport(dto.importType, actor);
    return this.mappingTemplates.save(
      dto,
      actor.userId,
      actor,
      await this.access.isAdministrator(actor),
    );
  }

  async removeMappingTemplate(id: string, actor: ImportActor) {
    return this.mappingTemplates.remove(
      id,
      actor,
      await this.access.isAdministrator(actor),
    );
  }

  /** The type's sales template (`lang` = header language), with a product of the actor's own catalogue as sample. */
  async salesTemplate(type: string, actor: ImportActor, lang: 'ar' | 'en') {
    await this.access.assertCanImport(type, actor);
    return this.templates.generateSales(
      type,
      importAudience(actor),
      lang,
      await this.catalog.sampleProductName(actor),
    );
  }

  /** Google Sheets connect step: the address to share with, and the actor's connected sheets. */
  async sheetConnections(actor: ImportActor) {
    await this.assertImportsAnything(actor);
    return {
      serviceAccountEmail: this.sheets.serviceAccount().email,
      connections: await this.sheets.list(actor),
    };
  }

  async revokeSheetConnection(id: string, actor: ImportActor) {
    await this.assertImportsAnything(actor);
    return this.sheets.revoke(id, actor);
  }

  private async assertImportsAnything(actor: ImportActor) {
    if ((await this.access.importableTypes(actor)).length === 0) {
      throw new ForbiddenException({
        code: 'IMPORT_PERMISSION_REQUIRED',
        message:
          'لا تملك صلاحية أي استيراد — You do not have any import permission.',
      });
    }
  }
}

function confirmation(rowId: string, result: ImportRowResult) {
  return {
    id: rowId,
    confirmed: true as const,
    ...(result.skipped ? { skipped: result.skipped } : {}),
    ...(result.notice ? { notice: result.notice } : {}),
  };
}
