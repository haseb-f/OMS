import { Workbook } from 'exceljs';
import type { ParsedTable } from './csv-parser.util';

/**
 * Reads the first worksheet of an uploaded Excel workbook into the exact
 * same `{ headers, rows }` shape `parseCsv` produces (Phase 2.5) — the
 * Mapping Engine, Preview, and `run()` never know or care which format the
 * file was. Prefers a sheet literally named "Import Data" (the Template
 * Service's own Data sheet) so uploading an unmodified downloaded Template
 * always works, but falls back to the first sheet for any other workbook.
 */
export async function parseXlsx(buffer: Buffer): Promise<ParsedTable> {
  const workbook = new Workbook();
  // exceljs's ambient Buffer type predates @types/node's generic Buffer<TArrayBuffer> — structurally identical, TS-incompatible.
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.getWorksheet('Import Data') ?? workbook.worksheets[0];
  if (!sheet) {
    return { headers: [], rows: [] };
  }

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    headers.push(cellToString(cell.value));
  });

  const rows: Record<string, string>[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const record: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      const value = cellToString(row.getCell(index + 1).value);
      if (value) hasValue = true;
      record[header] = value;
    });
    if (hasValue) rows.push(record);
  }

  return { headers, rows };
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const obj = value as {
      richText?: { text: string }[];
      text?: string;
      result?: unknown;
    };
    if (Array.isArray(obj.richText))
      return obj.richText.map((part) => part.text).join('');
    if (typeof obj.text === 'string') return obj.text;
    if ('result' in obj) return cellToString(obj.result);
    return '';
  }
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${value}`;
  return '';
}
