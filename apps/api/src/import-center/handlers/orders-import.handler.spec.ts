import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PermissionsCoreModule } from '../../permissions/permissions-core.module';
import { PhoneModule } from '../../common/phone/phone.module';
import { AuthModule } from '../../auth/auth.module';
import { ImportCenterModule } from '../import-center.module';
import { OrdersImportHandler } from './orders-import.handler';

describe('OrdersImportHandler — Lead-as-Order retired', () => {
  let moduleRef: TestingModule;
  let handler: OrdersImportHandler;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        PermissionsCoreModule,
        PhoneModule,
        AuthModule,
        ImportCenterModule,
      ],
    }).compile();
    await moduleRef.init();
    handler = moduleRef.get(OrdersImportHandler);
  });

  afterAll(async () => {
    if (moduleRef) await moduleRef.close();
  });

  it('is unavailable and refuses to create Lead-as-Order rows', async () => {
    expect(handler.isAvailable).toBe(false);
    await expect(
      handler.importRow({
        externalOrderId: 'ORDERS-RETIRED-1',
        customerName: 'Should not import',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
