import {
  matchReferenceRecords,
  matchCodeSuffix,
} from './match-reference-records';
import type { ReferenceRecord } from './reference-data.types';

describe('matchReferenceRecords', () => {
  const products: ReferenceRecord[] = [
    {
      id: 'p1',
      code: 'SKU-1',
      name: 'منتج اختبار',
      active: true,
    },
    {
      id: 'p2',
      code: 'SKU-2',
      name: 'منتج آخر',
      active: true,
    },
  ];

  it('resolves an Arabic product display name to the existing record', () => {
    expect(matchReferenceRecords(products, 'name', 'منتج اختبار')).toEqual([
      products[0],
    ]);
  });

  it('collapses surrounding and repeated whitespace', () => {
    expect(
      matchReferenceRecords(products, 'name', '  منتج   اختبار  '),
    ).toEqual([products[0]]);
  });

  it('does not treat SKU as a product display name', () => {
    expect(matchReferenceRecords(products, 'name', 'SKU-1')).toEqual([]);
  });

  it('does not require a UUID', () => {
    expect(matchReferenceRecords(products, 'name', 'p1')).toEqual([]);
  });

  it('returns no match for an unknown product', () => {
    expect(matchReferenceRecords(products, 'name', 'منتج غير موجود')).toEqual(
      [],
    );
  });

  it('returns every record when the display name is ambiguous', () => {
    const duplicates: ReferenceRecord[] = [
      { id: 'a', code: 'A', name: 'منتج اختبار', active: true },
      { id: 'b', code: 'B', name: '  منتج اختبار ', active: true },
    ];
    expect(
      matchReferenceRecords(duplicates, 'name', 'منتج اختبار'),
    ).toHaveLength(2);
  });

  it('matches currency by code and payment method / country / employee / shipping company by their List Sheet field', () => {
    expect(
      matchReferenceRecords(
        [{ id: 'sar', code: 'SAR', name: 'Saudi Riyal', active: true }],
        'code',
        ' sar ',
      ),
    ).toEqual([{ id: 'sar', code: 'SAR', name: 'Saudi Riyal', active: true }]);
    expect(
      matchReferenceRecords(
        [{ id: 'c1', code: 'SA', name: 'السعودية', active: true }],
        'name',
        'السعودية',
      ),
    ).toHaveLength(1);
    expect(
      matchReferenceRecords(
        [{ id: 'pm', code: null, name: 'تحويل بنكي', active: true }],
        'name',
        'تحويل بنكي',
      ),
    ).toHaveLength(1);
    expect(
      matchReferenceRecords(
        [
          {
            id: 'u1',
            code: 'employee@example.com',
            name: 'Ignored',
            active: true,
          },
        ],
        'code',
        '  employee@example.com ',
      ),
    ).toHaveLength(1);
    expect(
      matchReferenceRecords(
        [{ id: 'sc', code: null, name: 'SMSA', active: true }],
        'name',
        'SMSA',
      ),
    ).toHaveLength(1);
  });

  it('keeps the documented Name (CODE) suffix fallback without silently swapping SKU for name', () => {
    expect(matchCodeSuffix(products, 'منتج اختبار (SKU-1)')).toEqual([
      products[0],
    ]);
    expect(matchCodeSuffix(products, 'منتج اختبار')).toEqual([]);
  });
});
