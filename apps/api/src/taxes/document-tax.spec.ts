import { BadRequestException } from '@nestjs/common';
import { resolveTaxesById } from './document-tax';

describe('resolveTaxesById', () => {
  it('throws when a taxId cannot be resolved instead of treating it as zero', async () => {
    const prisma = {
      tax: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    await expect(
      resolveTaxesById(prisma as never, ['missing-tax-id']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns rate 0 for an explicit zero-rated tax', async () => {
    const prisma = {
      tax: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'vat0', code: 'VAT0', rate: 0, inclusive: false },
          ]),
      },
    };
    const map = await resolveTaxesById(prisma as never, ['vat0']);
    expect(map.get('vat0')).toEqual({ rate: 0, inclusive: false });
  });
});
