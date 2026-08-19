import { createHash } from 'crypto';
import {
  classifyStoreOrderGroups,
  fingerprintMappedRows,
  sheetCell,
  storeOrderWritebackValues,
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

  it('skips an already imported row that has an OMS order number', () => {
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
    expect(row.includeInReview).toBe(false);
    expect(row.needsSheetNumberWriteback).toBe(false);
  });

  it('writes back the OMS number when the DB order exists but the sheet is blank', () => {
    const [row] = classifyStoreOrderGroups({
      groups: [
        {
          rowNumbers: [3],
          mappedRows: [sourceFields()],
          sourceRow: {},
        },
      ],
      existingByExternalId: new Map([
        ['12345', { internalOrderId: 'STO-2026-000123' }],
      ]),
      previous: {},
    });
    expect(row.lifecycle).toBe('IMPORTED');
    expect(row.runValidation).toBe(false);
    expect(row.needsSheetNumberWriteback).toBe(true);
  });

  it('retries a previously failed row only after the source fields change', () => {
    const failedHash = fingerprintMappedRows([
      sourceFields({ countryName: 'X' }),
    ]);
    const unchanged = classifyStoreOrderGroups({
      groups: [
        {
          rowNumbers: [25],
          mappedRows: [sourceFields({ countryName: 'X' })],
          sourceRow: {
            'Sync Status': STORE_ORDER_SHEET_STATUS.error,
            'Error Message': 'الدولة غير معروفة',
          },
        },
      ],
      existingByExternalId: new Map(),
      previous: {
        '12345': { hash: failedHash, status: 'ERROR' },
      },
    });
    expect(unchanged[0].lifecycle).toBe('UNCHANGED_FAILURE');
    expect(unchanged[0].runValidation).toBe(false);
    expect(unchanged[0].includeInReview).toBe(false);

    const changed = classifyStoreOrderGroups({
      groups: [
        {
          rowNumbers: [25],
          mappedRows: [sourceFields({ countryName: 'السعودية' })],
          sourceRow: {
            'Sync Status': STORE_ORDER_SHEET_STATUS.error,
            'Error Message': 'الدولة غير معروفة',
          },
        },
      ],
      existingByExternalId: new Map(),
      previous: {
        '12345': { hash: failedHash, status: 'ERROR' },
      },
    });
    expect(changed[0].lifecycle).toBe('RETRY');
    expect(changed[0].changed).toBe(true);
    expect(changed[0].runValidation).toBe(true);
  });

  it('retries an unchanged failure when the operator explicitly requests it', () => {
    const failedHash = fingerprintMappedRows([sourceFields()]);
    const [row] = classifyStoreOrderGroups({
      groups: [
        {
          rowNumbers: [25],
          mappedRows: [sourceFields()],
          sourceRow: { 'Sync Status': 'REJECTED' },
        },
      ],
      existingByExternalId: new Map(),
      previous: { '12345': { hash: failedHash, status: 'ERROR' } },
      retryRowNumbers: [25],
    });
    expect(row.lifecycle).toBe('RETRY');
    expect(row.runValidation).toBe(true);
  });

  it('treats a new row as actionable', () => {
    const [row] = classifyStoreOrderGroups({
      groups: [
        {
          rowNumbers: [2],
          mappedRows: [sourceFields({ externalOrderId: 'NEW-1' })],
          sourceRow: {},
        },
      ],
      existingByExternalId: new Map(),
      previous: {},
    });
    expect(row.lifecycle).toBe('NEW');
    expect(row.runValidation).toBe(true);
    expect(row.includeInReview).toBe(true);
  });

  it('writes Arabic status values into the existing managed columns only', () => {
    expect(
      storeOrderWritebackValues({
        status: 'imported',
        internalOrderId: 'STO-2026-000123',
      }),
    ).toEqual({
      'Sync Status': 'تم الاستيراد',
      'System Order ID': 'STO-2026-000123',
      'Error Message': '',
    });
    expect(
      storeOrderWritebackValues({
        status: 'error',
        issues: [{ message: 'Country "X" is not a recognized Country.' }],
      }),
    ).toEqual({
      'Sync Status': 'خطأ',
      'System Order ID': '',
      'Error Message': 'الدولة غير معروفة',
    });
  });
});
