import { Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { ImportTypeRegistryService } from './import-type-registry.service';
import type { ImportFieldDef, ImportFieldType } from './import-type.interface';

const FORMAT_HINT: Record<ImportFieldType, string> = {
  string: 'Text',
  number: 'Number (e.g. 1500.00 — no currency symbols or thousands separators)',
  date: 'Date (YYYY-MM-DD)',
  boolean: 'TRUE or FALSE',
};

const REQUIRED_HEADER_ARGB = 'FFC0392B';
const OPTIONAL_HEADER_ARGB = 'FF7F8C8D';
const REQUIRED_ROW_ARGB = 'FFFBE2E1';
const OPTIONAL_ROW_ARGB = 'FFF1F2F4';
const GUIDE_HEADER_ARGB = 'FF2C3E50';

/**
 * Excel Template Generator (Phase 2.5) — the ONE place a downloadable
 * Import Template is produced, always from the same `ImportFieldDef[]` an
 * `ImportTypeHandler` already registers with `ImportTypeRegistryService`
 * (TASK-056). Never hardcode columns per page/module: a field added to a
 * handler's `fields` array is automatically in every future generated
 * Template, with no template-specific code to update.
 */
@Injectable()
export class ImportTemplateService {
  constructor(private readonly registry: ImportTypeRegistryService) {}

  async generate(type: string): Promise<{ buffer: Buffer; fileName: string }> {
    const handler = this.registry.get(type);
    const workbook = new Workbook();
    workbook.creator = 'OMS Import Center';
    workbook.created = new Date();

    this.buildDataSheet(workbook, handler.fields);
    this.buildFieldGuideSheet(workbook, handler.fields);

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const fileName = `${type.toLowerCase().replace(/_/g, '-')}-import-template.xlsx`;
    return { buffer: Buffer.from(arrayBuffer), fileName };
  }

  private buildDataSheet(workbook: Workbook, fields: ImportFieldDef[]) {
    const sheet = workbook.addWorksheet('Import Data', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = fields.map((field) => ({
      header: `${field.label}${field.required ? ' *' : ''}`,
      key: field.key,
      width: Math.max(18, field.label.length + 4),
    }));

    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      const field = fields[colNumber - 1];
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: field.required ? REQUIRED_HEADER_ARGB : OPTIONAL_HEADER_ARGB,
        },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.note = [
        field.required ? 'Required' : 'Optional',
        `Format: ${FORMAT_HINT[field.type]}`,
        field.example ? `Example: ${field.example}` : undefined,
        field.options
          ? `Accepted values: ${field.options.join(', ')}`
          : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n');
    });

    // Data-validation dropdown for closed-set fields, over a generous row range for future entries.
    const TEMPLATE_ROWS = 200;
    fields.forEach((field, index) => {
      if (!field.options || field.options.length === 0) return;
      for (let rowNumber = 2; rowNumber <= TEMPLATE_ROWS; rowNumber++) {
        sheet.getCell(rowNumber, index + 1).dataValidation = {
          type: 'list',
          allowBlank: !field.required,
          formulae: [`"${field.options.join(',')}"`],
          showErrorMessage: true,
          errorTitle: 'Invalid value',
          error: `Must be one of: ${field.options.join(', ')}`,
        };
      }
    });
  }

  private buildFieldGuideSheet(workbook: Workbook, fields: ImportFieldDef[]) {
    const sheet = workbook.addWorksheet('Field Guide');
    sheet.columns = [
      { header: 'Column', key: 'column', width: 26 },
      { header: 'Required / Optional', key: 'required', width: 20 },
      { header: 'Type', key: 'type', width: 14 },
      { header: 'Format', key: 'format', width: 46 },
      { header: 'Example', key: 'example', width: 30 },
      { header: 'Accepted Values', key: 'options', width: 34 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: GUIDE_HEADER_ARGB },
      };
    });

    for (const field of fields) {
      const row = sheet.addRow({
        column: field.label,
        required: field.required ? 'Required' : 'Optional',
        type: field.type,
        format: FORMAT_HINT[field.type],
        example: field.example ?? '',
        options: field.options ? field.options.join(', ') : '',
      });
      const requiredCell = row.getCell('required');
      requiredCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: field.required ? REQUIRED_ROW_ARGB : OPTIONAL_ROW_ARGB,
        },
      };
    }
  }
}
