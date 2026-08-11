import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { google, sheets_v4 } from 'googleapis';

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
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
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

  private mapError(error: unknown): Error {
    const status =
      (error as { code?: number; status?: number })?.code ??
      (error as { code?: number; status?: number })?.status;
    if (status === 404) {
      return new BadRequestException(
        'That spreadsheet was not found — check the URL.',
      );
    }
    if (status === 403) {
      return new BadRequestException(
        "Access denied — share this spreadsheet with the integration's service-account email address (Viewer access).",
      );
    }
    return new BadRequestException('Could not read that Google Sheet.');
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

  /** Resolves a URL's numeric `gid` (or no gid — first sheet) to the sheet's actual title, since `values.get()` addresses ranges by title, not gid. */
  private async resolveSheetTitle(
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
}
