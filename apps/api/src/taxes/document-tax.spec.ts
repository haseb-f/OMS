import { BadRequestException } from '@nestjs/common';
import { resolveLineTaxes, resolveTaxesById } from './document-tax';

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

describe('resolveLineTaxes', () => {
  it('inherits Product.taxId when the line omits taxId', async () => {
    const prisma = {
      product: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'prod-1', taxId: 'vat15' }]),
      },
      tax: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'vat15', code: 'VAT15', rate: 15, inclusive: false },
          ]),
      },
    };
    const result = await resolveLineTaxes(prisma as never, [
      { productId: 'prod-1' },
    ]);
    expect(result.taxIds).toEqual(['vat15']);
    expect(result.taxById.get('vat15')?.rate).toBe(15);
  });

  it('keeps an explicit line taxId over the product default', async () => {
    const prisma = {
      product: { findMany: jest.fn() },
      tax: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'vat0', code: 'VAT0', rate: 0, inclusive: false },
          ]),
      },
    };
    const result = await resolveLineTaxes(prisma as never, [
      { productId: 'prod-1', taxId: 'vat0' },
    ]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(result.taxIds).toEqual(['vat0']);
  });
});
