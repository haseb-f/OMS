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
  const { headers, rows } = await parseXlsxWorkbook(buffer);
  return { headers, rows };
}

export interface XlsxParseLimits {
  /** Max data rows (header excluded) on the chosen sheet. */
  maxRows?: number;
  /** Max header columns on the chosen sheet. */
  maxColumns?: number;
}

export class XlsxLimitError extends Error {}

/**
 * `parseXlsx` plus the chosen sheet's name, loading the workbook ONCE, and
 * refusing (XlsxLimitError) before cell iteration when the sheet's declared
 * dimensions exceed `limits`.
 */
export async function parseXlsxWorkbook(
  buffer: Buffer,
  limits: XlsxParseLimits = {},
): Promise<ParsedTable & { sheetName: string | null }> {
  const workbook = new Workbook();
  // exceljs's ambient Buffer type predates @types/node's generic Buffer<TArrayBuffer> — structurally identical, TS-incompatible.
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.getWorksheet('Import Data') ?? workbook.worksheets[0];
  if (!sheet) {
    return { headers: [], rows: [], sheetName: null };
  }
  if (limits.maxRows !== undefined && sheet.rowCount - 1 > limits.maxRows) {
    throw new XlsxLimitError(
      `The sheet has ${sheet.rowCount - 1} rows — the limit is ${limits.maxRows} data rows per file. Split it into smaller files.`,
    );
  }
  if (
    limits.maxColumns !== undefined &&
    sheet.columnCount > limits.maxColumns
  ) {
    throw new XlsxLimitError(
      `The sheet has ${sheet.columnCount} columns — the limit is ${limits.maxColumns}.`,
    );
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

  return { headers, rows, sheetName: sheet.name };
}

/**
 * Zip-bomb pre-scan for an .xlsx (a zip) WITHOUT inflating it: reads the
 * central directory and sums the declared uncompressed sizes. Returns the
 * total, or throws XlsxLimitError when it exceeds `maxUncompressedBytes`,
 * the entry count exceeds `maxEntries`, the archive is ZIP64 (sizes beyond
 * 4 GB), or the directory cannot be read. Declared sizes can lie, so the
 * row/column caps in `parseXlsxWorkbook` remain the second line of defense.
 */
export function assertXlsxArchiveWithinLimits(
  buffer: Buffer,
  maxUncompressedBytes: number,
  maxEntries = 2000,
): number {
  const EOCD = 0x06054b50;
  const CEN = 0x02014b50;
  const minStart = Math.max(0, buffer.length - (0xffff + 22));
  let eocd = -1;
  for (let i = buffer.length - 22; i >= minStart; i--) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new XlsxLimitError('The file is not a valid .xlsx workbook.');
  }
  const entries = buffer.readUInt16LE(eocd + 10);
  const dirOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || dirOffset === 0xffffffff) {
    throw new XlsxLimitError('ZIP64 workbooks are not supported.');
  }
  if (entries > maxEntries) {
    throw new XlsxLimitError(
      `The workbook has ${entries} internal parts — the limit is ${maxEntries}.`,
    );
  }
  let offset = dirOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CEN) {
      throw new XlsxLimitError('The file is not a valid .xlsx workbook.');
    }
    const size = buffer.readUInt32LE(offset + 24);
    if (size === 0xffffffff) {
      throw new XlsxLimitError('ZIP64 workbooks are not supported.');
    }
    total += size;
    if (total > maxUncompressedBytes) {
      throw new XlsxLimitError(
        `The workbook expands to more than ${Math.round(maxUncompressedBytes / 1024 / 1024)} MB when opened — split it into smaller files.`,
      );
    }
    offset +=
      46 +
      buffer.readUInt16LE(offset + 28) +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
  }
  return total;
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
