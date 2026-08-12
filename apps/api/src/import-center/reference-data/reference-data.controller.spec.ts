import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportCenterModule } from '../import-center.module';
import { StoreOrdersModule } from '../../store-orders/store-orders.module';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { GoogleSheetsService } from '../google-sheets.service';
import { ReferenceDataController } from './reference-data.controller';

describe('ReferenceDataController', () => {
  let moduleRef: TestingModule;
  let controller: ReferenceDataController;
  let prisma: PrismaService;
  let writeReferenceColumns: jest.Mock;

  beforeAll(async () => {
    writeReferenceColumns = jest.fn().mockResolvedValue(undefined);
    const fakeSheets = {
      writeReferenceColumns,
    };

    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        ImportCenterModule,
        StoreOrdersModule,
      ],
    })
      .overrideProvider(GoogleSheetsService)
      .useValue(fakeSheets)
      .compile();
    await moduleRef.init();

    controller = moduleRef.get(ReferenceDataController);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('lists every registered reference type', () => {
    const types = controller.listTypes().map((t) => t.type);
    expect(types).toEqual(
      expect.arrayContaining(['COUNTRY', 'CURRENCY', 'PRODUCT', 'CUSTOMER']),
    );
  });

  it('returns only active Currency records', async () => {
    const records = await controller.listRecords('CURRENCY');
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.active)).toBe(true);
    const dbCount = await prisma.currency.count({ where: { deletedAt: null } });
    expect(records.length).toBe(dbCount);
  });

  it('pushes reference columns to the sheet only after resolving live Master Data, never duplicating business data', async () => {
    await controller.pushToSheet({
      spreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit',
      types: ['CURRENCY', 'COUNTRY'],
    });

    expect(writeReferenceColumns).toHaveBeenCalledTimes(1);
    const [spreadsheetId, worksheetName, columns] = writeReferenceColumns.mock
      .calls[0] as [string, string, { header: string; values: string[] }[]];
    expect(spreadsheetId).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz');
    expect(worksheetName).toBe('Reference Data');
    expect(columns).toHaveLength(2);
    expect(columns[0].values.length).toBeGreaterThan(0);
  });
});
