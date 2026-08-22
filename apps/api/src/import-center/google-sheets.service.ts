import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { google, sheets_v4 } from 'googleapis';
import {
  planManagedColumnWrites,
  planMissingResultColumnIndexes,
  resolveResultColumnIndexes,
  type ManagedColumnLayout,
} from './google-sheets.managed-columns';

export interface GoogleSheetMetadata {
  title: string;
  sheets: { sheetId: number; title: string }[];
}

export interface SheetStructureCheck {
  valid: boolean;
  missing: string[];
  extra: string[];
}

/** `+CC` — how a CSV field with a comma/quote/newline must be quoted (RFC 4180). */
function csvEscape(value: string | null | undefined): string {
  const text = value ?? '';
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The ONE place the backend talks to the Google Sheets API (Part 5) —
 * server-account authenticated, never a public "anyone with the link" CSV
 * export. Every `ImportJob` Google Sheets read (`ImportJobsService.
 * uploadFromGoogleSheets`/`refresh`) goes through this service; no page
 * component or frontend code ever sees a Google credential.
 *
 * Auth: reads a service-account key from `GOOGLE_SERVICE_ACCOUNT_KEY` (raw
 * JSON or base64-encoded JSON) — never committed to the repo, never sent to
 * the browser. The service account's own email must be shared ("Viewer") on
 * every spreadsheet this reads; a 403 from Google surfaces that exact
 * instruction back to the user rather than a generic failure.
 */
@Injectable()
export class GoogleSheetsService {
  private authClient: InstanceType<typeof google.auth.JWT> | null = null;

  private getAuth() {
    if (this.authClient) return this.authClient;
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!raw) {
      throw new InternalServerErrorException(
        'Google Sheets integration is not configured — set GOOGLE_SERVICE_ACCOUNT_KEY (the service account JSON key, raw or base64) in the environment.',
      );
    }
    const jsonText = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new InternalServerErrorException(
        'GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON (or base64-encoded JSON).',
      );
    }
    const credentials = parsed as {
      client_email?: unknown;
      private_key?: unknown;
    };
    if (
      typeof credentials.client_email !== 'string' ||
      typeof credentials.private_key !== 'string'
    ) {
      throw new InternalServerErrorException(
        'GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email/private_key.',
      );
    }
    this.authClient = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      // Full (read+write) `spreadsheets` scope — Data Synchronization's
      // write-back (`writeRowResults`) needs write access to the OMS
      // result columns it appends; `spreadsheets.readonly` alone can no
      // longer be used since a JWT client has exactly one scope set for
      // every request it makes. `drive.readonly` is unrelated (file
      // metadata only) and stays read-only.
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    });
    return this.authClient;
  }

  private sheetsClient(): sheets_v4.Sheets {
    return google.sheets({ version: 'v4', auth: this.getAuth() });
  }

  private driveClient() {
    return google.drive({ version: 'v3', auth: this.getAuth() });
  }

  private mapError(error: unknown, access: 'read' | 'write' = 'read'): Error {
    const status =
      (error as { code?: number; status?: number })?.code ??
      (error as { code?: number; status?: number })?.status;
    if (status === 404) {
      return new BadRequestException(
        'لم يتم العثور على جدول البيانات — تحقق من الرابط.',
      );
    }
    if (status === 403) {
      return new BadRequestException(
        access === 'write'
          ? 'تم رفض الوصول — شارك جدول البيانات مع بريد حساب الخدمة بصلاحية محرر.'
          : 'تم رفض الوصول — شارك جدول البيانات مع بريد حساب الخدمة بصلاحية عرض.',
      );
    }
    return new BadRequestException(
      access === 'write'
        ? 'تعذر تحديث جدول بيانات Google. لم يتم تغيير حالة المزامنة في الشيت.'
        : 'تعذر قراءة جدول بيانات Google.',
    );
  }

  /** True if the service account's credentials are configured and Google accepts them — never throws. */
  async validateConnection(): Promise<boolean> {
    try {
      await this.getAuth().authorize();
      return true;
    } catch {
      return false;
    }
  }

  async getSpreadsheetMetadata(
    spreadsheetId: string,
  ): Promise<GoogleSheetMetadata> {
    try {
      const res = await this.sheetsClient().spreadsheets.get({
        spreadsheetId,
      });
      return {
        title: res.data.properties?.title ?? '',
        sheets: (res.data.sheets ?? []).map((sheet) => ({
          sheetId: sheet.properties?.sheetId ?? 0,
          title: sheet.properties?.title ?? '',
        })),
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /** Resolves a URL's numeric `gid` (or no gid — first sheet) to the sheet's actual title, since `values.get()` addresses ranges by title, not gid. Public — also used by `SyncSourceConfigService` to resolve/display a configured worksheet's current title without duplicating this lookup. */
  async resolveSheetTitle(
    spreadsheetId: string,
    gid: string | undefined,
  ): Promise<string> {
    const metadata = await this.getSpreadsheetMetadata(spreadsheetId);
    if (metadata.sheets.length === 0) {
      throw new BadRequestException('That spreadsheet has no sheets.');
    }
    if (gid === undefined) return metadata.sheets[0].title;
    const match = metadata.sheets.find(
      (sheet) => String(sheet.sheetId) === gid,
    );
    return (match ?? metadata.sheets[0]).title;
  }

  /**
   * Strict gid lookup — unlike `resolveSheetTitle`, this never falls back
   * to the first worksheet. Used by OMS → List Sheet so we cannot silently
   * write a different tab.
   */
  async resolveSheetTitleByGid(
    spreadsheetId: string,
    gid: string,
  ): Promise<string> {
    const metadata = await this.getSpreadsheetMetadata(spreadsheetId);
    const match = metadata.sheets.find(
      (sheet) => String(sheet.sheetId) === gid,
    );
    if (!match) {
      throw new BadRequestException(
        `The configured worksheet (gid ${gid}) was not found in this spreadsheet.`,
      );
    }
    return match.title;
  }

  /** The raw 2D grid of cell values — row 0 is assumed to be the header row by every other method here. */
  async getSheetData(spreadsheetId: string, gid?: string): Promise<string[][]> {
    const title = await this.resolveSheetTitle(spreadsheetId, gid);
    try {
      const res = await this.sheetsClient().spreadsheets.values.get({
        spreadsheetId,
        range: title,
      });
      return (res.data.values ?? []) as string[][];
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async getHeaders(spreadsheetId: string, gid?: string): Promise<string[]> {
    const values = await this.getSheetData(spreadsheetId, gid);
    return values[0] ?? [];
  }

  /** Every data row (excluding the header) as a header-keyed object. */
  async getRows(
    spreadsheetId: string,
    gid?: string,
  ): Promise<Record<string, string>[]> {
    const [headers, ...rows] = await this.getSheetData(spreadsheetId, gid);
    if (!headers) return [];
    return rows.map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, row[index] ?? '']),
      ),
    );
  }

  /**
   * Drop-in replacement for the old public-CSV export fetch — the exact
   * same CSV text shape `csv-parser.util.ts` already parses, now sourced
   * from the authenticated Sheets API instead of a public "anyone with the
   * link" export URL. `ImportJobsService.uploadFromGoogleSheets()`/
   * `refresh()` are the only callers.
   */
  async getSheetAsCsv(spreadsheetId: string, gid?: string): Promise<string> {
    const values = await this.getSheetData(spreadsheetId, gid);
    return values.map((row) => row.map(csvEscape).join(',')).join('\n');
  }

  /** Drive API's `modifiedTime` — Sheets API itself has no "last edited" field; the service account needs `drive.readonly` (already requested above) to read this. */
  async getLastUpdatedMetadata(
    spreadsheetId: string,
  ): Promise<{ modifiedTime: string | null }> {
    try {
      const res = await this.driveClient().files.get({
        fileId: spreadsheetId,
        fields: 'modifiedTime',
      });
      return { modifiedTime: res.data.modifiedTime ?? null };
    } catch {
      return { modifiedTime: null };
    }
  }

  /** Compares the sheet's actual header row against a template's expected headers — used before import to catch a mismatched/reordered sheet early, with an actionable diff instead of a row-by-row parse failure. */
  async validateSheetStructure(
    spreadsheetId: string,
    expectedHeaders: string[],
    gid?: string,
  ): Promise<SheetStructureCheck> {
    const headers = (await this.getHeaders(spreadsheetId, gid)).map((h) =>
      h.trim(),
    );
    const headerSet = new Set(headers);
    const expectedSet = new Set(expectedHeaders);
    return {
      valid: expectedHeaders.every((h) => headerSet.has(h)),
      missing: expectedHeaders.filter((h) => !headerSet.has(h)),
      extra: headers.filter((h) => h && !expectedSet.has(h)),
    };
  }

  /**
   * Data Synchronization write-back — appends dedicated "OMS ..." result
   * columns to the END of the header row (creating each one, once, on
   * first use) and returns its A1 column letter keyed by the caller's own
   * column name. Never touches an existing column — an already-present
   * header with the same name is reused as-is, so re-running a sync never
   * duplicates or shifts a result column.
   */
  async ensureResultColumns(
    spreadsheetId: string,
    columnNames: string[],
    gid?: string,
    options?: { minStartColumn?: string },
  ): Promise<Record<string, string>> {
    const title = await this.resolveSheetTitle(spreadsheetId, gid);
    const headers = await this.getHeaders(spreadsheetId, gid);
    const { columnIndexByName, missing } = resolveResultColumnIndexes(
      headers,
      columnNames,
    );
    const columnLetters: Record<string, string> = {};
    for (const [name, index] of Object.entries(columnIndexByName)) {
      columnLetters[name] = columnIndexToLetter(index);
    }
    if (missing.length === 0) return columnLetters;

    const planned = planMissingResultColumnIndexes(
      headers,
      missing,
      options?.minStartColumn,
    );
    try {
      await this.sheetsClient().spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'RAW',
          data: missing.map((name) => ({
            range: `${quoteSheetTitle(title)}!${columnIndexToLetter(planned[name])}1`,
            values: [[name]],
          })),
        },
      });
    } catch (error) {
      throw this.mapError(error, 'write');
    }
    for (const [name, index] of Object.entries(planned)) {
      columnLetters[name] = columnIndexToLetter(index);
    }
    return columnLetters;
  }

  /**
   * Renames a header cell in row 1 by exact trimmed match. Preserves all
   * data cells in that column. Used to migrate legacy `Status` →
   * `Shipping Status` without creating an empty duplicate column.
   */
  async renameHeader(
    spreadsheetId: string,
    fromHeader: string,
    toHeader: string,
    gid?: string,
  ): Promise<boolean> {
    const from = fromHeader.trim();
    const to = toHeader.trim();
    if (!from || !to || from === to) return false;
    const title = await this.resolveSheetTitle(spreadsheetId, gid);
    const headers = await this.getHeaders(spreadsheetId, gid);
    const index = headers.findIndex((header) => (header ?? '').trim() === from);
    if (index < 0) return false;
    try {
      await this.sheetsClient().spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteSheetTitle(title)}!${columnIndexToLetter(index)}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [[to]] },
      });
    } catch (error) {
      throw this.mapError(error, 'write');
    }
    return true;
  }

  /**
   * Writes each row's result values into its own dedicated OMS column(s)
   * (auto-created via `ensureResultColumns`) at `rowNumber` (1-indexed
   * sheet row — header is row 1, first data row is row 2, the same
   * convention `ImportJobsService` uses) — never any other cell. Callers
   * (`SyncOrchestratorService`) only ever call this AFTER a successful
   * database commit, so a sheet never shows "تم" for a row that didn't
   * actually get written to the OMS.
   */
  async writeRowResults(
    spreadsheetId: string,
    rows: { rowNumber: number; values: Record<string, string> }[],
    gid?: string,
    options?: { minStartColumn?: string },
  ): Promise<void> {
    if (rows.length === 0) return;
    const columnNames = [
      ...new Set(rows.flatMap((row) => Object.keys(row.values))),
    ];
    const columnLetters = await this.ensureResultColumns(
      spreadsheetId,
      columnNames,
      gid,
      options,
    );
    const title = await this.resolveSheetTitle(spreadsheetId, gid);
    const data = rows.flatMap((row) =>
      Object.entries(row.values).map(([name, value]) => ({
        range: `${quoteSheetTitle(title)}!${columnLetters[name]}${row.rowNumber}`,
        values: [[value]],
      })),
    );
    try {
      await this.sheetsClient().spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data },
      });
    } catch (error) {
      throw this.mapError(error, 'write');
    }
  }

  /** Creates `title` as a new tab if the spreadsheet doesn't already have one by that name — idempotent, never touches an existing tab's content. */
  async ensureWorksheet(spreadsheetId: string, title: string): Promise<void> {
    const metadata = await this.getSpreadsheetMetadata(spreadsheetId);
    if (metadata.sheets.some((sheet) => sheet.title === title)) return;
    try {
      await this.sheetsClient().spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title } } }] },
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * Data Synchronization — Master Data reference worksheet (spec: "A
   * dedicated hidden/reference worksheet... can contain Countries,
   * Currencies, Products, ... Do NOT duplicate the actual business data.
   * The reference values must originate from OMS Master Data."). Writes
   * one column per reference type into `worksheetTitle` (creating the tab
   * if needed), OVERWRITING that tab's entire content every time — it
   * exists only to be pointed at by data-validation dropdowns on the
   * business-data tab, never hand-edited, so a full overwrite on refresh
   * is exactly right (never a merge).
   */
  async writeReferenceColumns(
    spreadsheetId: string,
    worksheetTitle: string,
    columns: { header: string; values: string[] }[],
  ): Promise<void> {
    await this.ensureWorksheet(spreadsheetId, worksheetTitle);
    const rowCount = Math.max(1, ...columns.map((c) => c.values.length)) + 1;
    const grid: string[][] = Array.from({ length: rowCount }, () =>
      new Array<string>(columns.length).fill(''),
    );
    columns.forEach((column, colIndex) => {
      grid[0][colIndex] = column.header;
      column.values.forEach((value, rowIndex) => {
        grid[rowIndex + 1][colIndex] = value;
      });
    });
    try {
      await this.sheetsClient().spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteSheetTitle(worksheetTitle)}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: grid },
      });
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /**
   * OMS → List Sheet: write only the named managed columns under the
   * configured header row. Headers are resolved by name — never rewritten,
   * never duplicated, never shifted. Stale values from dataStartRow down
   * in those columns are cleared. Title/header rows above dataStartRow and
   * unmanaged/future columns are never rewritten. Does not clear or
   * recreate the worksheet.
   */
  async writeManagedColumns(
    spreadsheetId: string,
    gid: string,
    columns: { header: string; values: string[] }[],
    layout: ManagedColumnLayout,
  ): Promise<void> {
    if (columns.length === 0) return;
    const title = await this.resolveSheetTitleByGid(spreadsheetId, gid);
    let grid: string[][];
    try {
      const res = await this.sheetsClient().spreadsheets.values.get({
        spreadsheetId,
        range: quoteSheetTitle(title),
      });
      grid = (res.data.values ?? []) as string[][];
    } catch (error) {
      throw this.mapError(error, 'write');
    }

    const { writes, headerWrites, missingHeaders } = planManagedColumnWrites(
      grid,
      columns,
      layout,
    );
    if (missingHeaders.length > 0) {
      throw new BadRequestException(
        `List Sheet is missing required headers in row ${layout.headerRow}: ${missingHeaders.join(', ')}.`,
      );
    }
    if (writes.length === 0 && headerWrites.length === 0) return;

    const quoted = quoteSheetTitle(title);
    const data = [
      ...headerWrites.map((write) => ({
        range: `${quoted}!${columnIndexToLetter(write.columnIndex)}${write.row}`,
        values: [[write.header]],
      })),
      ...writes.map((write) => {
        const letter = columnIndexToLetter(write.columnIndex);
        const endRow = write.startRow + write.cells.length - 1;
        return {
          range: `${quoted}!${letter}${write.startRow}:${letter}${endRow}`,
          values: write.cells.map((cell) => [cell]),
        };
      }),
    ];

    try {
      await this.sheetsClient().spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data },
      });
    } catch (error) {
      throw this.mapError(error, 'write');
    }
  }
}

/** 0-based column index -> A1 column letters (0 -> "A", 26 -> "AA", ...). */
function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** A1 notation requires a sheet title to be single-quoted whenever it isn't a bare alphanumeric/underscore token (e.g. it has spaces, like "Al Rajhi"). */
function quoteSheetTitle(title: string): string {
  return /^[A-Za-z0-9_]+$/.test(title)
    ? title
    : `'${title.replace(/'/g, "''")}'`;
}
