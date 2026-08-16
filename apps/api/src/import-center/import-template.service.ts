import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Workbook } from 'exceljs';
import { ImportTypeRegistryService } from './import-type-registry.service';
import { ReferenceDataRegistryService } from './reference-data/reference-data-registry.service';
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
/** Reserved sync write-back columns (e.g. Store Orders' "Sync Status") — a distinct, muted style from both Required (red) and Optional (grey) so they read as "not an input field" at a glance. */
const RESULT_HEADER_ARGB = 'FF95A5A6';
const RESULT_ROW_ARGB = 'FFECF0F1';
const REFERENCE_SHEET_NAME = 'Reference Data';
/** How many data rows get a dropdown/list validation — independent of how many values the dropdown's own source list holds (a "Reference Data" column can have far more than this). */
const TEMPLATE_ROWS = 200;

/**
 * Excel Template Generator (Phase 2.5; Master-Data-Aware Imports) — the
 * ONE place a downloadable Import Template is produced, always from the
 * same `ImportFieldDef[]` an `ImportTypeHandler` already registers with
 * `ImportTypeRegistryService` (TASK-056). Never hardcode columns per
 * page/module: a field added to a handler's `fields` array is
 * automatically in every future generated Template, with no
 * template-specific code to update.
 *
 * A field with `referenceType` set gets its dropdown values from the
 * CURRENT Master Data at generation time (`ReferenceDataRegistryService`,
 * active records only) via a hidden "Reference Data" sheet + range — never
 * a hardcoded list — so a template downloaded today always reflects
 * today's countries/products/etc., and one downloaded after an admin adds
 * a new active record picks it up automatically on the next download. A
 * closed enum (`options`) still uses the older inline-list validation —
 * that set never changes at runtime, so it needs no reference sheet.
 */
@Injectable()
export class ImportTemplateService {
  constructor(
    private readonly registry: ImportTypeRegistryService,
    private readonly referenceData: ReferenceDataRegistryService,
  ) {}

  async generate(type: string): Promise<{ buffer: Buffer; fileName: string }> {
    const handler = this.registry.get(type);
    const workbook = new Workbook();
    workbook.creator = 'OMS Import Center';
    workbook.created = new Date();

    const referenceColumns = await this.buildReferenceDataSheet(
      workbook,
      handler.fields,
    );
    this.buildDataSheet(
      workbook,
      handler.fields,
      referenceColumns,
      handler.resultColumns ?? [],
    );
    this.buildFieldGuideSheet(workbook, handler.fields, type);

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const fileName = `${type.toLowerCase().replace(/_/g, '-')}-import-template.xlsx`;
    return { buffer: Buffer.from(arrayBuffer), fileName };
  }

  /** `Template Version` — a hash of the handler's field keys/required flags/types, stamped on the Field Guide sheet so an outdated re-uploaded template is at least visually detectable; see the handler doc comment for the (deliberately not yet automated) upload-time check. */
  private computeTemplateVersion(fields: ImportFieldDef[]): string {
    const signature = fields
      .map((f) => `${f.key}:${f.required ? 1 : 0}:${f.type}`)
      .join('|');
    return createHash('sha1').update(signature).digest('hex').slice(0, 8);
  }

  /**
   * One hidden column per distinct `(referenceType, matchField)` pair a
   * field actually uses — two fields on the same reference type but
   * different match fields (e.g. Warehouse matched by code in one field,
   * by name in another) get separate columns, since the dropdown's actual
   * values differ. Returns each pair's column letter for
   * `buildDataSheet`'s dropdown formula.
   */
  private async buildReferenceDataSheet(
    workbook: Workbook,
    fields: ImportFieldDef[],
  ): Promise<Map<string, string>> {
    const pairs = new Map<
      string,
      { type: string; matchField: 'code' | 'name'; displayWithCode: boolean }
    >();
    for (const field of fields) {
      if (!field.referenceType) continue;
      const source = this.referenceData.get(field.referenceType);
      const matchField = field.referenceMatchField ?? source.defaultMatchField;
      const displayWithCode = !!field.referenceDisplayWithCode;
      pairs.set(`${field.referenceType}:${matchField}:${displayWithCode}`, {
        type: field.referenceType,
        matchField,
        displayWithCode,
      });
    }

    const columnLetters = new Map<string, string>();
    if (pairs.size === 0) return columnLetters;

    const sheet = workbook.addWorksheet(REFERENCE_SHEET_NAME, {
      state: 'veryHidden',
    });

    let columnIndex = 1;
    for (const [key, { type, matchField, displayWithCode }] of pairs) {
      const source = this.referenceData.get(type);
      const records = await source.list();
      // A "name (code)" composite (spec: friendly display, stable
      // resolution) only ever applies to a record that actually has a
      // code — one without falls back to its bare match-field value, same
      // as every other reference column.
      const values = [
        ...new Set(
          records
            .filter((r) => r.active)
            .map((r) => {
              const base = matchField === 'code' ? r.code : r.name;
              if (displayWithCode && r.code && base !== r.code) {
                return `${base} (${r.code})`;
              }
              return base;
            })
            .filter((v): v is string => Boolean(v)),
        ),
      ].sort((a, b) => a.localeCompare(b));

      const letter = columnIndexToLetter(columnIndex);
      sheet.getCell(1, columnIndex).value = `${source.label} (${matchField})`;
      values.forEach((value, rowOffset) => {
        sheet.getCell(rowOffset + 2, columnIndex).value = value;
      });
      // A blank sheet has no valid non-empty range for Excel's list
      // validation — guarantee at least one populated row so the
      // dropdown formula below always resolves.
      const lastRow = Math.max(values.length, 1) + 1;
      // Sheet-qualified A1 ranges require the sheet name single-quoted
      // whenever it isn't a bare alphanumeric/underscore token — "Reference
      // Data" has a space, so an unquoted `Reference Data!$A$2:$A$10` is
      // invalid Excel syntax: Excel still renders the dropdown arrow (the
      // dataValidation rule itself is well-formed XML) but silently treats
      // the list source as empty, since it can't resolve the range.
      columnLetters.set(
        key,
        `'${REFERENCE_SHEET_NAME}'!$${letter}$2:$${letter}$${lastRow}`,
      );
      columnIndex++;
    }

    return columnLetters;
  }

  private buildDataSheet(
    workbook: Workbook,
    fields: ImportFieldDef[],
    referenceColumns: Map<string, string>,
    resultColumns: string[],
  ) {
    const sheet = workbook.addWorksheet('Import Data', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = [
      ...fields.map((field) => ({
        header: `${field.label}${field.required ? ' *' : ''}`,
        key: field.key,
        width: Math.max(18, field.label.length + 4),
      })),
      ...resultColumns.map((label) => ({
        header: label,
        key: `__result__${label}`,
        width: Math.max(18, label.length + 4),
      })),
    ];

    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      // A reserved result column (past the last real field) — the OMS
      // sync write-back, never user input; styled distinctly (grey, not
      // red/dark-grey) and never gets validation/a Field Guide row.
      if (colNumber > fields.length) {
        cell.font = { bold: true, italic: true, color: { argb: 'FF2C3E50' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: RESULT_HEADER_ARGB },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.note =
          'Reserved — written by OMS after each sync (Sync Status / System Order ID / Error Message). Do not enter import data here.';
        return;
      }
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
        field.referenceType
          ? 'Choose from the dropdown — only existing, active records are accepted.'
          : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n');
    });

    // Reserved result columns get a light fill on every data row too, so
    // the "do not type here" boundary is visible without opening the note.
    if (resultColumns.length > 0) {
      for (let rowNumber = 2; rowNumber <= TEMPLATE_ROWS; rowNumber++) {
        for (let offset = 0; offset < resultColumns.length; offset++) {
          const cell = sheet.getCell(rowNumber, fields.length + 1 + offset);
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: RESULT_ROW_ARGB },
          };
        }
      }
    }

    fields.forEach((field, index) => {
      const column = index + 1;

      // Closed enum — unchanged inline-list validation.
      if (field.options && field.options.length > 0) {
        for (let rowNumber = 2; rowNumber <= TEMPLATE_ROWS; rowNumber++) {
          sheet.getCell(rowNumber, column).dataValidation = {
            type: 'list',
            allowBlank: !field.required,
            formulae: [`"${field.options.join(',')}"`],
            showErrorMessage: true,
            errorTitle: 'Invalid value',
            error: `Must be one of: ${field.options.join(', ')}`,
          };
        }
        return;
      }

      // Master Data — dropdown backed by the hidden Reference Data sheet, always the current active list.
      if (field.referenceType) {
        const source = this.referenceData.get(field.referenceType);
        const matchField =
          field.referenceMatchField ?? source.defaultMatchField;
        const range = referenceColumns.get(
          `${field.referenceType}:${matchField}:${!!field.referenceDisplayWithCode}`,
        );
        if (!range) return;
        for (let rowNumber = 2; rowNumber <= TEMPLATE_ROWS; rowNumber++) {
          sheet.getCell(rowNumber, column).dataValidation = {
            type: 'list',
            allowBlank: !field.required,
            formulae: [range],
            showErrorMessage: true,
            errorTitle: 'Not a recognized value',
            error: `Choose an existing, active ${source.label} — this column doesn't accept free text.`,
          };
        }
      }
    });
  }

  private buildFieldGuideSheet(
    workbook: Workbook,
    fields: ImportFieldDef[],
    type: string,
  ) {
    const sheet = workbook.addWorksheet('Field Guide');
    sheet.getCell('A1').value = 'OMS Import Template';
    sheet.getCell('A2').value = `Type: ${type}`;
    sheet.getCell('A3').value =
      `Version: ${this.computeTemplateVersion(fields)}`;
    sheet.getCell('A1').font = { bold: true };
    sheet.getCell('A3').font = { italic: true, color: { argb: 'FF7F8C8D' } };

    const tableStartRow = 5;
    const headerRow = sheet.getRow(tableStartRow);
    headerRow.values = [
      'Column',
      'Required / Optional',
      'Type',
      'Format',
      'Example',
      'Accepted Values',
    ];
    sheet.columns = [
      { key: 'column', width: 26 },
      { key: 'required', width: 20 },
      { key: 'type', width: 14 },
      { key: 'format', width: 46 },
      { key: 'example', width: 30 },
      { key: 'options', width: 34 },
    ];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: GUIDE_HEADER_ARGB },
      };
    });

    for (const field of fields) {
      const acceptedValues = field.options
        ? field.options.join(', ')
        : field.referenceType
          ? `An existing, active ${this.referenceData.get(field.referenceType).label} (see the dropdown on the Import Data sheet)`
          : '';
      const row = sheet.addRow({
        column: field.label,
        required: field.required ? 'Required' : 'Optional',
        type: field.type,
        format: FORMAT_HINT[field.type],
        example: field.example ?? '',
        options: acceptedValues,
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

/** 0-based-free (1-based) column index -> A1 column letters (1 -> "A", 27 -> "AA", ...). */
function columnIndexToLetter(index: number): string {
  let n = index;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}
