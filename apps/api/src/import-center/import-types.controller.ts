import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { ImportTypeRegistryService } from './import-type-registry.service';
import { ImportTemplateService } from './import-template.service';

/** Read-only: drives the Import Center dashboard's type picker, the Mapping Engine's field list, and the downloadable Excel Template (Phase 2.5). */
@Controller('import-center/types')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('import-center')
export class ImportTypesController {
  constructor(
    private readonly registry: ImportTypeRegistryService,
    private readonly templateService: ImportTemplateService,
  ) {}

  @Get()
  list() {
    return this.registry.list().map((handler) => ({
      type: handler.type,
      labelKey: handler.labelKey,
      descriptionKey: handler.descriptionKey,
      fields: handler.fields,
      isAvailable: handler.isAvailable,
    }));
  }

  /** "Never an Excel import without a matching downloadable Template" — generated live from the same field schema `list()` returns, never a hand-authored file. */
  @Get(':type/template')
  async downloadTemplate(@Param('type') type: string, @Res() res: Response) {
    const { buffer, fileName } = await this.templateService.generate(type);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}
