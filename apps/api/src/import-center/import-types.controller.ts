import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ImportTypeRegistryService } from './import-type-registry.service';
import { ImportTemplateService } from './import-template.service';
import { ImportAccessService } from './import-access.service';
import { ImportWorkspaceService } from './import-workspace.service';
import { sendWorkbook } from './send-workbook.util';

/**
 * Read-only: the type picker / mapping field list and the downloadable Excel
 * templates. R15 — the list is the caller's importable types (every type for
 * the Import Center dashboard holders), so the sales import screens never
 * need `import-center.view`; the sales template carries only that user's
 * columns. The full administrator template keeps `import-center.view`.
 */
@Controller('import-center')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ImportTypesController {
  constructor(
    private readonly registry: ImportTypeRegistryService,
    private readonly templateService: ImportTemplateService,
    private readonly access: ImportAccessService,
    private readonly workspace: ImportWorkspaceService,
  ) {}

  @Get('types')
  async list(@CurrentUser() user: JwtPayload) {
    const actor = { userId: user.sub };
    return this.workspace.types(
      actor,
      (await this.access.browsesAllTypes(actor))
        ? this.registry.list()
        : undefined,
    );
  }

  /** "Never an Excel import without a matching downloadable Template" — generated live from the same field schema `list()` returns, never a hand-authored file. */
  @Get('types/:type/template')
  @PermissionModule('import-center')
  async downloadTemplate(@Param('type') type: string, @Res() res: Response) {
    sendWorkbook(res, await this.templateService.generate(type));
  }

  /** R15 — the sales import template (Arabic or English headers, a sample row). */
  @Get('types/:type/sales-template')
  async downloadSalesTemplate(
    @Param('type') type: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
    @Query('lang') lang?: string,
  ) {
    sendWorkbook(
      res,
      await this.workspace.salesTemplate(
        type,
        { userId: user.sub },
        lang === 'en' ? 'en' : 'ar',
      ),
    );
  }

  /** R15 (D15-17) — the service-account address to share a private sheet with, and the caller's connected sheets. */
  @Get('google-sheets/connections')
  sheetConnections(@CurrentUser() user: JwtPayload) {
    return this.workspace.sheetConnections({ userId: user.sub });
  }

  @Delete('google-sheets/connections/:id')
  @HttpCode(200)
  revokeSheetConnection(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspace.revokeSheetConnection(id, { userId: user.sub });
  }
}
