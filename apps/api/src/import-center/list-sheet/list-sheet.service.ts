import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GoogleSheetsService } from '../google-sheets.service';
import { ReferenceDataRegistryService } from '../reference-data/reference-data-registry.service';
import {
  LIST_SHEET_COLUMNS,
  LIST_SHEET_GID,
  LIST_SHEET_SPREADSHEET_ID,
  type ListSheetColumnDef,
  type ListSheetColumnKey,
} from './list-sheet.catalog';
import { normalizeListValues } from './list-sheet.normalize';

export type ListSheetSyncStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';
export type ListSheetListStatus = 'SUCCESS' | 'FAILED';

export interface ListSheetListResult {
  key: ListSheetColumnKey;
  header: string;
  status: ListSheetListStatus;
  count: number;
  message?: string;
}

export interface ListSheetSyncResult {
  status: ListSheetSyncStatus;
  spreadsheetId: string;
  worksheetGid: string;
  syncedAt: string;
  lists: ListSheetListResult[];
}

/**
 * OMS → official Google List Sheet. Loads current master/reference display
 * values, then writes only the managed columns. Unmanaged/future columns
 * are never cleared. Opposite direction of the four inbound syncs.
 */
@Injectable()
export class ListSheetService {
  private readonly logger = new Logger(ListSheetService.name);
  private inFlight: Promise<ListSheetSyncResult> | null = null;

  constructor(
    private readonly registry: ReferenceDataRegistryService,
    private readonly googleSheets: GoogleSheetsService,
  ) {}

  publish(): Promise<ListSheetSyncResult> {
    if (this.inFlight) {
      return Promise.reject(
        new BadRequestException(
          'تعذر بدء المزامنة لأن عملية مزامنة أخرى لا تزال قيد التنفيذ.',
        ),
      );
    }
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<ListSheetSyncResult> {
    const lists: ListSheetListResult[] = [];
    const columnsToWrite: { header: string; values: string[] }[] = [];

    for (const def of LIST_SHEET_COLUMNS) {
      try {
        const values = normalizeListValues(await this.loadValues(def));
        lists.push({
          key: def.key,
          header: def.header,
          status: 'SUCCESS',
          count: values.length,
        });
        columnsToWrite.push({ header: def.header, values });
      } catch (error) {
        this.logger.warn(
          `List Sheet load failed for ${def.key}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        lists.push({
          key: def.key,
          header: def.header,
          status: 'FAILED',
          count: 0,
          message: 'تعذر تحميل هذه القائمة من النظام.',
        });
      }
    }

    if (columnsToWrite.length === 0) {
      return {
        status: 'FAILED',
        spreadsheetId: LIST_SHEET_SPREADSHEET_ID,
        worksheetGid: LIST_SHEET_GID,
        syncedAt: new Date().toISOString(),
        lists,
      };
    }

    try {
      await this.googleSheets.writeManagedColumns(
        LIST_SHEET_SPREADSHEET_ID,
        LIST_SHEET_GID,
        columnsToWrite,
      );
    } catch (error) {
      const message = this.toUserErrorMessage(error);
      return {
        status: 'FAILED',
        spreadsheetId: LIST_SHEET_SPREADSHEET_ID,
        worksheetGid: LIST_SHEET_GID,
        syncedAt: new Date().toISOString(),
        lists: lists.map((list) =>
          list.status === 'SUCCESS'
            ? { ...list, status: 'FAILED', count: 0, message }
            : list,
        ),
      };
    }

    const failedCount = lists.filter((list) => list.status === 'FAILED').length;
    return {
      status:
        failedCount === 0
          ? 'SUCCESS'
          : failedCount === lists.length
            ? 'FAILED'
            : 'PARTIAL',
      spreadsheetId: LIST_SHEET_SPREADSHEET_ID,
      worksheetGid: LIST_SHEET_GID,
      syncedAt: new Date().toISOString(),
      lists,
    };
  }

  private async loadValues(def: ListSheetColumnDef): Promise<string[]> {
    const source = def.source;
    if (source.kind === 'static') return source.values;
    const records = await this.registry.get(source.type).list();
    return records
      .filter((record) => record.active)
      .map((record) => source.valueOf(record) ?? '');
  }

  private toUserErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : '';
    if (raw.includes('not configured')) {
      return 'تعذر الاتصال بـ Google Sheets. إعداد التكامل غير مكتمل.';
    }
    if (raw.includes('Access denied')) {
      return 'تعذر الوصول إلى ورقة List Sheet. تأكد من منح حساب التكامل صلاحية التعديل.';
    }
    if (raw.includes('gid') || raw.includes('worksheet')) {
      return 'تعذر العثور على ورقة List Sheet المطلوبة.';
    }
    if (raw.includes('not found') || raw.includes('spreadsheet')) {
      return 'تعذر العثور على جدول Google Sheets الرسمي.';
    }
    return 'تعذر مزامنة بيانات OMS مع Google Sheets. حاول مرة أخرى.';
  }
}
