import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PermissionModule } from '../../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../../auth/decorators/permission-action.decorator';
import { GoogleSheetsService } from '../google-sheets.service';
import { parseGoogleSheetsUrl } from '../google-sheets.util';
import { ReferenceDataRegistryService } from './reference-data-registry.service';
import { PushReferenceDataDto } from './dto/push-reference-data.dto';

const DEFAULT_WORKSHEET_NAME = 'Reference Data';

/**
 * Master-Data-aware imports — the read side (`GET`) backs the Excel
 * Template's dropdowns' web equivalent (a searchable combobox on any
 * import config form) and lets the frontend discover which reference
 * types exist without hardcoding the list twice. The write side (`POST
 * .../push`) is section 5/11's "the system should be able to
 * provide/configure the reference lists a Google Sheet uses" — never
 * duplicates business data into the sheet, only the current Master Data
 * values a data-validation dropdown on the business tab can point at.
 */
@Controller('import-center/reference-data')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('import-center')
export class ReferenceDataController {
  constructor(
    private readonly registry: ReferenceDataRegistryService,
    private readonly googleSheets: GoogleSheetsService,
  ) {}

  @Get()
  @PermissionAction('view')
  listTypes() {
    return this.registry.list().map((source) => ({
      type: source.type,
      label: source.label,
      defaultMatchField: source.defaultMatchField,
    }));
  }

  /** Active records only — a combobox should never offer an inactive/archived value to pick. */
  @Get(':type')
  @PermissionAction('view')
  async listRecords(@Param('type') type: string) {
    const records = await this.registry.get(type).list();
    return records.filter((record) => record.active);
  }

  @Post('push')
  @PermissionAction('import')
  async pushToSheet(@Body() dto: PushReferenceDataDto) {
    const { spreadsheetId } = parseGoogleSheetsUrl(dto.spreadsheetUrl);
    const columns = await Promise.all(
      dto.types.map(async (type) => {
        const source = this.registry.get(type);
        const records = (await source.list()).filter((r) => r.active);
        const values = [
          ...new Set(
            records
              .map(
                (r) => r[source.defaultMatchField === 'code' ? 'code' : 'name'],
              )
              .filter((v): v is string => Boolean(v)),
          ),
        ].sort((a, b) => a.localeCompare(b));
        return {
          header: `${source.label} (${source.defaultMatchField})`,
          values,
        };
      }),
    );
    await this.googleSheets.writeReferenceColumns(
      spreadsheetId,
      dto.worksheetName ?? DEFAULT_WORKSHEET_NAME,
      columns,
    );
    return {
      spreadsheetId,
      worksheetName: dto.worksheetName ?? DEFAULT_WORKSHEET_NAME,
      types: dto.types,
    };
  }
}
