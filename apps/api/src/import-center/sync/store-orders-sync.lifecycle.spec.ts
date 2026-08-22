import { createHash } from 'crypto';
import {
  classifyDeletedStoreOrderGroups,
  classifyStoreOrderGroups,
  externalDupWritebackValues,
  fingerprintMappedRows,
  isSheetSuccessfullyImported,
  normalizeExternalOrderId,
  phoneSkipWritebackValues,
  sheetCell,
  storeOrderWritebackValues,
  STORE_ORDER_DELETED_ROW_BASE,
  STORE_ORDER_RESULT_COLUMNS,
  STORE_ORDER_SHEET_STATUS,
} from './store-orders-sync.lifecycle';

const sourceFields = (overrides: Record<string, string> = {}) => ({
  externalOrderId: '12345',
  orderDate: '2026-08-01',
  customerName: 'Ahmed',
  customerPhone: '512345678',
  countryName: 'السعودية',
  address: 'Riyadh',
  productSku: 'SKU-1',
  quantity: '1',
  paidAmount: '99',
  currencyCode: 'SAR',
  paymentMethodLabel: 'Tabby',
  receipt1: '',
  receipt2: '',
  receipt3: '',
  notes: '',
  agentEmail: 'agent@test.com',
  ...overrides,
});

describe('store-orders-sync.lifecycle', () => {
  it('normalizes external order ids with trim + lowercase', () => {
    expect(normalizeExternalOrderId('  AbC-1 ')).toBe('abc-1');
  });

  it('reads trimmed managed column names from the source row', () => {
    expect(
      sheetCell(
        { ' Sync Status ': 'تم الاستيراد', 'System Order ID': 'STO-1' },
        STORE_ORDER_RESULT_COLUMNS.syncStatus,
      ),
    ).toBe('تم الاستيراد');
  });

  it('fingerprints source fields and changes when country is corrected', () => {
    const before = fingerprintMappedRows([sourceFields({ countryName: 'X' })]);
    const after = fingerprintMappedRows([
      sourceFields({ countryName: 'السعودية' }),
    ]);
    expect(before).not.toBe(after);
    expect(before).toHaveLength(64);
    expect(createHash('sha256').update(before).digest('hex')).toHaveLength(64);
  });

  it('treats case variants of external id as the same fingerprint identity', () => {
    const a = fingerprintMappedRows([sourceFields({ externalOrderId: 'ABC' })]);
    const b = fingerprintMappedRows([sourceFields({ externalOrderId: 'abc' })]);
    expect(a).toBe(b);
  });

  it('skips an already imported row when System Order ID is present', () => {
    expect(
      isSheetSuccessfullyImported({
        'System Order ID': 'STO-2026-000123',
        'Sync Status': '',
      }),
    ).toBe(true);

    const [row] = classifyStoreOrderGroups({
      groups: [
        {
          rowNumbers: [2],
          mappedRows: [sourceFields()],
          sourceRow: {
            'Sync Status': '',
            'System Order ID': 'STO-2026-000123',
          },
        },
      ],
      existingByExternalId: new Map(),
      previous: {},
    });
    expect(row.lifecycle).toBe('IMPORTED');
    expect(row.runValidation).toBe(false);
    expect(row.includeInReview).toBe(false);
  });

  it('skips successful sync status even without re-running validation', () => {
    const [row] = classifyStoreOrderGroups({
      groups: [
        {
          rowNumbers: [2],
          mappedRows: [sourceFields()],
          sourceRow: {
            'Sync Status': STORE_ORDER_SHEET_STATUS.imported,
            'System Order ID': 'STO-2026-000123',
          },
        },
      ],
      existingByExternalId: new Map([
        ['12345', { internalOrderId: 'STO-2026-000123' }],
      ]),
      previous: {},
    });
    expect(row.lifecycle).toBe('IMPORTED');
    expect(row.runValidation).toBe(false);
  });

  it('auto-rejects existing external order id without update or review', () => {
    const [row] = classifyStoreOrderGroups({
      groups: [
        {
          rowNumbers: [2],
          mappedRows: [sourceFields({ externalOrderId: 'ABC-1' })],
          sourceRow: {},
        },
      ],
      existingByExternalId: new Map([['abc-1', { internalOrderId: 'STO-9' }]]),
      previous: {},
    });
    expect(row.lifecycle).toBe('EXTERNAL_DUP');
    expect(row.runValidation).toBe(false);
    expect(row.includeInReview).toBe(false);
    expect(row.existingInternalOrderId).toBe('STO-9');
    expect(
      externalDupWritebackValues({
        displayExternalOrderId: 'ABC-1',
        existingInternalOrderId: 'STO-9',
      })['Sync Status'],
    ).toBe(STORE_ORDER_SHEET_STATUS.rejectedExternalExists);
  });

  it('marks phone-match rows for review (not auto-create)', () => {
    const [row] = classifyStoreOrderGroups({
      groups: [
        {
          rowNumbers: [5],
          mappedRows: [sourceFields({ externalOrderId: 'NEW-99' })],
          sourceRow: {},
        },
      ],
      existingByExternalId: new Map(),
      phoneByGroupRow: new Map([[5, '+966512345678']]),
      priorOrderByPhone: new Map([
        [
          '+966512345678',
          {
            internalOrderId: 'STO-OLD',
            externalOrderId: 'OLD-1',
            orderDate: '2026-01-01',
          },
        ],
      ]),
      previous: {},
    });
    expect(row.lifecycle).toBe('PHONE_MATCH');
    expect(row.includeInReview).toBe(true);
    expect(row.priorOrder?.internalOrderId).toBe('STO-OLD');
    expect(
      phoneSkipWritebackValues({ priorInternalOrderId: 'STO-OLD' })[
        'Sync Status'
      ],
    ).toBe(STORE_ORDER_SHEET_STATUS.rejectedPhoneSkip);
  });

  it('allows retry of a failed row with no System Order ID after correction', () => {
    const [row] = classifyStoreOrderGroups({
      groups: [
        {
          rowNumbers: [3],
          mappedRows: [sourceFields({ countryName: 'السعودية' })],
          sourceRow: {
            'Sync Status': STORE_ORDER_SHEET_STATUS.error,
            'System Order ID': '',
            'Error Message': 'old',
          },
        },
      ],
      existingByExternalId: new Map(),
      previous: {
        '12345': { hash: 'old-hash', status: 'ERROR' },
      },
    });
    expect(row.lifecycle).toBe('RETRY');
    expect(row.runValidation).toBe(true);
    expect(row.includeInReview).toBe(true);
  });

  it('does not reprocess unchanged failed rows without retry', () => {
    const hash = fingerprintMappedRows([sourceFields()]);
    const [row] = classifyStoreOrderGroups({
      groups: [
        {
          rowNumbers: [3],
          mappedRows: [sourceFields()],
          sourceRow: {
            'Sync Status': STORE_ORDER_SHEET_STATUS.error,
            'System Order ID': '',
          },
        },
      ],
      existingByExternalId: new Map(),
      previous: {
        '12345': { hash, status: 'ERROR' },
      },
    });
    expect(row.lifecycle).toBe('UNCHANGED_FAILURE');
    expect(row.runValidation).toBe(false);
  });

  it('classifies empty result rows as NEW', () => {
    const [row] = classifyStoreOrderGroups({
      groups: [
        {
          rowNumbers: [2],
          mappedRows: [sourceFields({ externalOrderId: 'brand-new' })],
          sourceRow: {},
        },
      ],
      existingByExternalId: new Map(),
      previous: {},
    });
    expect(row.lifecycle).toBe('NEW');
    expect(row.runValidation).toBe(true);
  });

  it('writes imported / error Arabic statuses', () => {
    expect(
      storeOrderWritebackValues({
        status: 'imported',
        internalOrderId: 'STO-1',
      })['Sync Status'],
    ).toBe(STORE_ORDER_SHEET_STATUS.imported);
    expect(
      storeOrderWritebackValues({
        status: 'error',
        issues: [{ message: 'x' }],
      })['Sync Status'],
    ).toBe(STORE_ORDER_SHEET_STATUS.error);
  });

  it('detects deleted previously-imported identities', () => {
    const deleted = classifyDeletedStoreOrderGroups({
      currentKeys: ['keep'],
      previous: {
        keep: { hash: 'a', status: 'IMPORTED', internalOrderId: 'STO-1' },
        gone: { hash: 'b', status: 'IMPORTED', internalOrderId: 'STO-2' },
      },
    });
    expect(deleted).toHaveLength(1);
    expect(deleted[0].internalOrderId).toBe('STO-2');
    expect(deleted[0].sentinelRowNumber).toBe(STORE_ORDER_DELETED_ROW_BASE);
  });
});
