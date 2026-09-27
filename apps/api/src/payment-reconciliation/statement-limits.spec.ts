import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import {
  PaymentStatementsService,
  STATEMENT_MAX_COLUMNS,
  STATEMENT_MAX_ROWS,
  canonicalSheetSource,
} from './payment-statements.service';
import {
  XlsxLimitError,
  assertXlsxArchiveWithinLimits,
  parseXlsxWorkbook,
} from '../import-center/xlsx-parser.util';

/**
 * FIX-PDR M3/M4 — statement upload caps (zip expansion, rows, columns) and
 * Google Sheet URL canonicalisation. Pure: no database, no network.
 */
async function xlsx(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Statement');
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// readUploadedFile touches none of the injected services.
const service = new PaymentStatementsService(
  null as never,
  null as never,
  null as never,
);

describe('statement upload limits', () => {
  it('pre-scans the xlsx central directory without inflating it', async () => {
    const buffer = await xlsx([
      ['Ref', 'Amount'],
      ['A', 1],
    ]);
    const total = assertXlsxArchiveWithinLimits(buffer, 50 * 1024 * 1024);
    expect(total).toBeGreaterThan(0);
    expect(() => assertXlsxArchiveWithinLimits(buffer, 100)).toThrow(
      XlsxLimitError,
    );
    expect(() =>
      assertXlsxArchiveWithinLimits(Buffer.from('not a zip at all'), 1e6),
    ).toThrow(XlsxLimitError);
  });

  it('parses the workbook once, returns the sheet name, and enforces row/column caps', async () => {
    const buffer = await xlsx([
      ['Ref', 'Amount'],
      ['A', 1],
      ['B', 2],
    ]);
    const parsed = await parseXlsxWorkbook(buffer, { maxRows: 5 });
    expect(parsed.sheetName).toBe('Statement');
    expect(parsed.rows).toHaveLength(2);
    await expect(parseXlsxWorkbook(buffer, { maxRows: 1 })).rejects.toThrow(
      XlsxLimitError,
    );
    await expect(parseXlsxWorkbook(buffer, { maxColumns: 1 })).rejects.toThrow(
      XlsxLimitError,
    );
  });

  it('readUploadedFile maps xlsx caps to 400s and keeps real row numbers', async () => {
    const ok = await service.readUploadedFile({
      originalname: 'statement.xlsx',
      buffer: await xlsx([
        ['Ref', 'Amount'],
        ['A', 1],
      ]),
    });
    expect(ok.sheetName).toBe('Statement');
    expect(ok.rows[0]).toMatchObject({ rowNumber: 2, raw: { Ref: 'A' } });

    const wide = await xlsx([
      Array.from({ length: STATEMENT_MAX_COLUMNS + 1 }, (_, i) => `c${i}`),
    ]);
    await expect(
      service.readUploadedFile({ originalname: 'wide.xlsx', buffer: wide }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const tall = await xlsx([
      ['Ref'],
      ...Array.from({ length: STATEMENT_MAX_ROWS + 1 }, (_, i) => [`r${i}`]),
    ]);
    await expect(
      service.readUploadedFile({ originalname: 'tall.xlsx', buffer: tall }),
    ).rejects.toThrow(/limit is 5000/);

    await expect(
      service.readUploadedFile({
        originalname: 'corrupt.xlsx',
        buffer: Buffer.from('PK garbage'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Google Sheet URL canonicalisation', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';

  it('rebuilds the URL from the extracted id and numeric gid only', () => {
    expect(
      canonicalSheetSource(
        `https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing#gid=42`,
      ),
    ).toEqual({
      spreadsheetId: id,
      gid: '42',
      url: `https://docs.google.com/spreadsheets/d/${id}/edit#gid=42`,
    });
    expect(
      canonicalSheetSource(
        `javascript:alert(1)//x/spreadsheets/d/${id}/view"><script>`,
      ).url,
    ).toBe(`https://docs.google.com/spreadsheets/d/${id}/edit`);
    expect(
      canonicalSheetSource(`https://evil.example/spreadsheets/d/${id}/edit`)
        .url,
    ).toBe(`https://docs.google.com/spreadsheets/d/${id}/edit`);
  });

  it('rejects a missing or implausible spreadsheet id', () => {
    expect(() => canonicalSheetSource('https://example.com/')).toThrow(
      BadRequestException,
    );
    expect(() =>
      canonicalSheetSource('https://docs.google.com/spreadsheets/d/abc/edit'),
    ).toThrow(/invalid spreadsheet id/);
    expect(() => canonicalSheetSource('')).toThrow(BadRequestException);
  });
});
