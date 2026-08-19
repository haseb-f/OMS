import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { GoogleSheetsService } from '../google-sheets.service';
import { ReferenceDataRegistryService } from '../reference-data/reference-data-registry.service';
import type { ReferenceRecord } from '../reference-data/reference-data.types';
import {
  LIST_SHEET_GID,
  LIST_SHEET_SPREADSHEET_ID,
} from './list-sheet.catalog';
import { ListSheetService } from './list-sheet.service';

function record(
  name: string,
  extras: Partial<ReferenceRecord> = {},
): ReferenceRecord {
  return {
    id: extras.id ?? name,
    code: extras.code ?? null,
    name,
    active: extras.active ?? true,
  };
}

describe('ListSheetService', () => {
  let service: ListSheetService;
  let writeManagedColumns: jest.Mock;
  const lists: Record<string, ReferenceRecord[]> = {
    COUNTRY: [record('Saudi Arabia'), record('  Saudi Arabia  '), record('')],
    PRODUCT: [record('أهم 5000 كلمة', { id: 'uuid-should-not-appear' })],
    CURRENCY: [record('Saudi Riyal', { code: 'SAR' })],
    PAYMENT_METHOD: [record('Bank Transfer')],
    EMPLOYEE: [
      record('Ignored Name', { code: 'employee@example.com' }),
      record('Inactive', { code: 'gone@example.com', active: false }),
    ],
    SHIPPING_COMPANY: [record('SMSA')],
  };

  beforeEach(async () => {
    writeManagedColumns = jest.fn().mockResolvedValue(undefined);
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ListSheetService,
        {
          provide: ReferenceDataRegistryService,
          useValue: {
            get: (type: string) => ({
              list: () => Promise.resolve(lists[type] ?? []),
            }),
          },
        },
        {
          provide: GoogleSheetsService,
          useValue: { writeManagedColumns },
        },
      ],
    }).compile();
    service = moduleRef.get(ListSheetService);
  });

  it('publishes human-readable OMS values to the official List Sheet gid', async () => {
    const result = await service.publish();

    expect(result.status).toBe('SUCCESS');
    expect(result.spreadsheetId).toBe(LIST_SHEET_SPREADSHEET_ID);
    expect(result.worksheetGid).toBe(LIST_SHEET_GID);
    expect(writeManagedColumns).toHaveBeenCalledTimes(1);
    const [spreadsheetId, gid, columns, layout] = writeManagedColumns.mock
      .calls[0] as [
      string,
      string,
      { header: string; values: string[] }[],
      { headerRow: number; dataStartRow: number; startColumn: string },
    ];
    expect(spreadsheetId).toBe(LIST_SHEET_SPREADSHEET_ID);
    expect(gid).toBe(LIST_SHEET_GID);
    expect(layout).toEqual({
      headerRow: 2,
      dataStartRow: 3,
      startColumn: 'A',
    });

    const byHeader = Object.fromEntries(
      columns.map((column) => [column.header, column.values]),
    );
    expect(byHeader.Country).toEqual(['Saudi Arabia']);
    expect(byHeader.Product).toEqual(['أهم 5000 كلمة']);
    expect(byHeader.Currency).toEqual(['SAR']);
    expect(byHeader['Payment Method']).toEqual(['Bank Transfer']);
    expect(byHeader['Employee Email']).toEqual(['employee@example.com']);
    expect(byHeader['Shipping Company']).toEqual(['SMSA']);
    expect(byHeader['Shipping Status']).toEqual(
      expect.arrayContaining(['جاهز للشحن', 'تم الشحن']),
    );
    expect(byHeader['Shipping Status']).not.toEqual(
      expect.arrayContaining(['SHIPPED', 'READY_FOR_SHIPPING']),
    );
    expect(JSON.stringify(columns)).not.toContain('uuid-should-not-appear');
    expect(JSON.stringify(columns)).not.toContain('gone@example.com');
    expect(service.status().lastSyncedAt).toBe(result.syncedAt);
  });

  it('reports PARTIAL when one list fails to load and still writes the others', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ListSheetService,
        {
          provide: ReferenceDataRegistryService,
          useValue: {
            get: (type: string) => ({
              list: () => {
                if (type === 'PAYMENT_METHOD') {
                  return Promise.reject(new Error('db down'));
                }
                return Promise.resolve(lists[type] ?? []);
              },
            }),
          },
        },
        {
          provide: GoogleSheetsService,
          useValue: { writeManagedColumns },
        },
      ],
    }).compile();
    const partialService = moduleRef.get(ListSheetService);

    const result = await partialService.publish();
    expect(result.status).toBe('PARTIAL');
    const payment = result.lists.find((list) => list.key === 'paymentMethod');
    expect(payment?.status).toBe('FAILED');
    const written = (
      writeManagedColumns.mock.calls[0] as [
        string,
        string,
        { header: string }[],
      ]
    )[2];
    expect(written.map((column) => column.header)).not.toContain(
      'Payment Method',
    );
    expect(written.map((column) => column.header)).toContain('Country');
  });

  it('does not claim success when the Google write fails', async () => {
    writeManagedColumns.mockRejectedValue(
      new BadRequestException(
        "Access denied — share this spreadsheet with the integration's service-account email address (Editor access).",
      ),
    );
    const result = await service.publish();
    expect(result.status).toBe('FAILED');
    expect(result.lists.every((list) => list.status === 'FAILED')).toBe(true);
    expect(result.lists[0].message).toContain('صلاحية التعديل');
  });

  it('rejects a second concurrent publish', async () => {
    let resolveWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    writeManagedColumns.mockImplementation(() => writeGate);

    const first = service.publish();
    await expect(service.publish()).rejects.toBeInstanceOf(BadRequestException);
    resolveWrite();
    await first;
  });
});
