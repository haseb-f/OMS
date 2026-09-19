import { BadRequestException } from '@nestjs/common';
import { AccountMappingService } from './account-mapping.service';
import type { PrismaService } from '../../prisma/prisma.service';

describe('AccountMappingService', () => {
  it('throws BadRequestException (not a 500) when a required account is unmapped', async () => {
    const prisma = {
      customerProfile: { findUnique: jest.fn().mockResolvedValue(null) },
      postingSettings: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new AccountMappingService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.resolveReceivableAccount('partner-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.resolveReceivableAccount('partner-1')).rejects.toThrow(
      /Accounts Receivable/,
    );
  });

  it('preflights sales invoice mappings and rejects inventory lines with no cost', async () => {
    const prisma = {
      customerProfile: {
        findUnique: jest.fn().mockResolvedValue({
          defaultReceivableAccountId: 'ar-1',
          customerGroup: null,
        }),
      },
      postingSettings: {
        findFirst: jest.fn().mockResolvedValue({
          accountsReceivableAccountId: 'ar-1',
          salesRevenueAccountId: 'rev-1',
        }),
      },
      productCategory: { findUnique: jest.fn().mockResolvedValue(null) },
      customerGroup: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new AccountMappingService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.assertSalesInvoiceMappings({
        partnerId: 'partner-1',
        items: [
          {
            categoryId: null,
            isInventoryItem: true,
            sku: 'SKU-1',
            currentCost: null,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.assertSalesInvoiceMappings({
        partnerId: 'partner-1',
        items: [
          {
            categoryId: null,
            isInventoryItem: true,
            sku: 'SKU-1',
            currentCost: null,
          },
        ],
      }),
    ).rejects.toThrow(/no recorded cost/);
  });
});
