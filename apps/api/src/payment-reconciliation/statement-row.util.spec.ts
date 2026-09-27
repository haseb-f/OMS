import {
  EXCEPTION_REASON,
  classifyProviderStatus,
  decideStatementUpsert,
  normalizeStatementRow,
  parseStatementAmount,
  parseStatementDate,
  statementDedupeKey,
  statementRowHash,
  statusFromAllocation,
  suggestStatementMapping,
  validateStatementMapping,
  type StatementMappingConfig,
} from './statement-row.util';

const CODES = new Set(['EGP', 'SAR', 'USD']);
const CONFIG: StatementMappingConfig = {
  columns: {
    providerReference: 'Ref',
    customerName: 'Name',
    customerPhone: 'Phone',
    amount: 'Amount',
    currency: 'Currency',
    transactionDate: 'Date',
    providerStatus: 'Status',
    orderReference: 'Order',
    fee: 'Fee',
    net: 'Net',
  },
  dateFormat: 'DMY',
};

function row(overrides: Record<string, string> = {}) {
  return {
    Ref: 'TX-1',
    Name: 'أحمد علي',
    Phone: '+201001234567',
    Amount: '1,250.50',
    Currency: 'egp',
    Date: '20/09/2026',
    Status: 'Captured',
    Order: 'SO-100',
    Fee: '',
    Net: '',
    ...overrides,
  };
}

describe('statement mapping', () => {
  it('suggests columns from English and Arabic headers', () => {
    const mapping = suggestStatementMapping([
      'Transaction ID',
      'اسم العميل',
      'المبلغ',
      'العملة',
      'التاريخ',
      'Status',
      'رقم الطلب',
    ]);
    expect(mapping).toEqual({
      providerReference: 'Transaction ID',
      customerName: 'اسم العميل',
      amount: 'المبلغ',
      currency: 'العملة',
      transactionDate: 'التاريخ',
      providerStatus: 'Status',
      orderReference: 'رقم الطلب',
    });
  });

  it('reports missing required fields, unknown headers and double-mapped columns', () => {
    const errors = validateStatementMapping(
      {
        columns: { amount: 'Amount', providerReference: 'Amount', fee: 'Nope' },
      },
      ['Amount'],
    );
    expect(errors.join(' | ')).toMatch(/transactionDate/);
    expect(errors.join(' | ')).toMatch(/currency/);
    expect(errors.join(' | ')).toMatch(/"Nope"/);
    expect(errors.join(' | ')).toMatch(/more than one field/);
  });

  it('accepts a default currency instead of a currency column', () => {
    expect(
      validateStatementMapping(
        {
          columns: { amount: 'Amount', transactionDate: 'Date' },
          defaultCurrencyCode: 'SAR',
        },
        ['Amount', 'Date'],
      ),
    ).toEqual([]);
  });
});

describe('row validation', () => {
  it('normalizes a valid row (amount, currency, date, trimmed text)', () => {
    const result = normalizeStatementRow(row(), CONFIG, CODES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row).toEqual(
      expect.objectContaining({
        providerReference: 'TX-1',
        amount: 1250.5,
        currencyCode: 'EGP',
        transactionDate: '2026-09-20',
        feeAmount: null,
        netAmount: null,
      }),
    );
  });

  it.each([
    [{ Amount: '0' }, /greater than zero/],
    [{ Amount: '-5' }, /greater than zero/],
    [{ Amount: 'abc' }, /not a number/],
    [{ Currency: 'XYZ' }, /not defined/],
    [{ Date: '31/02/2026' }, /could not be read/],
    [{ Date: '' }, /date is required/],
    [{ Fee: '2000' }, /larger than the amount/],
    [{ Fee: '10', Net: '1000' }, /does not equal/],
    [{ Net: '5000' }, /larger than the amount/],
  ])('rejects %p', (overrides, message) => {
    const result = normalizeStatementRow(row(overrides), CONFIG, CODES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(message);
  });

  it('derives net from fee and fee from net', () => {
    const fromFee = normalizeStatementRow(row({ Fee: '50.50' }), CONFIG, CODES);
    expect(fromFee.ok && fromFee.row.netAmount).toBe(1200);
    const fromNet = normalizeStatementRow(row({ Net: '1200' }), CONFIG, CODES);
    expect(fromNet.ok && fromNet.row.feeAmount).toBe(50.5);
    const both = normalizeStatementRow(
      row({ Fee: '50.50', Net: '1200.00' }),
      CONFIG,
      CODES,
    );
    expect(both.ok).toBe(true);
  });

  it('reads Arabic-Indic digits, ISO and Excel-serial dates', () => {
    expect(parseStatementAmount('١٬٢٥٠٫٥٠').value).toBe(1250.5);
    expect(parseStatementDate('2026-09-20T13:00:00Z')).toBe('2026-09-20');
    expect(parseStatementDate('09/20/2026', 'MDY')).toBe('2026-09-20');
    expect(parseStatementDate('46285')).toBe('2026-09-20');
  });
});

describe('hash + dedupe key', () => {
  it('ignores formatting noise and uses the provider reference when present', () => {
    const a = normalizeStatementRow(row(), CONFIG, CODES);
    const b = normalizeStatementRow(
      row({ Name: '  احمد   علي ', Amount: '1250.5', Currency: 'EGP' }),
      CONFIG,
      CODES,
    );
    if (!a.ok || !b.ok) throw new Error('rows should be valid');
    expect(statementRowHash(a.row)).toBe(statementRowHash(b.row));
    expect(statementDedupeKey(a.row, statementRowHash(a.row))).toBe('ref:TX-1');
  });

  it('falls back to the content hash without a reference', () => {
    const r = normalizeStatementRow(row({ Ref: '' }), CONFIG, CODES);
    if (!r.ok) throw new Error('row should be valid');
    const hash = statementRowHash(r.row);
    expect(statementDedupeKey(r.row, hash)).toBe(`hash:${hash}`);
  });
});

describe('dedupe decision', () => {
  const base = {
    status: 'UNMATCHED' as const,
    rowHash: 'h1',
    matchedAmount: 0,
    exceptionReason: null,
  };

  it('creates new keys', () => {
    expect(decideStatementUpsert(null, 'h1')).toBe('CREATE');
  });

  it('identical re-import is a duplicate (no change)', () => {
    expect(decideStatementUpsert(base, 'h1')).toBe('DUPLICATE');
    expect(
      decideStatementUpsert(
        { ...base, status: 'MATCHED', matchedAmount: 10 },
        'h1',
      ),
    ).toBe('DUPLICATE');
  });

  it('changed content on an unmatched line updates it', () => {
    expect(decideStatementUpsert(base, 'h2')).toBe('UPDATE');
  });

  it('changed content on a matched or partially allocated line becomes an exception', () => {
    expect(
      decideStatementUpsert(
        { ...base, status: 'MATCHED', matchedAmount: 10 },
        'h2',
      ),
    ).toBe('EXCEPTION_CHANGED_AFTER_MATCH');
    expect(decideStatementUpsert({ ...base, matchedAmount: 5 }, 'h2')).toBe(
      'EXCEPTION_CHANGED_AFTER_MATCH',
    );
  });

  it('a row deleted at source that comes back unchanged is re-opened (only if never matched)', () => {
    const deleted = {
      ...base,
      status: 'EXCEPTION' as const,
      exceptionReason: `${EXCEPTION_REASON.DELETED_AT_SOURCE} (sync x)`,
    };
    expect(decideStatementUpsert(deleted, 'h1')).toBe('REAPPEARED');
    expect(decideStatementUpsert({ ...deleted, matchedAmount: 3 }, 'h1')).toBe(
      'DUPLICATE',
    );
  });

  it('derives the allocation status', () => {
    expect(statusFromAllocation(100, 0)).toBe('UNMATCHED');
    expect(statusFromAllocation(100, 40)).toBe('UNMATCHED');
    expect(statusFromAllocation(100, 100)).toBe('MATCHED');
  });
});

describe('provider status', () => {
  it('classifies success / failure / unknown (Arabic too)', () => {
    expect(classifyProviderStatus('captured')).toBe('SUCCESS');
    expect(classifyProviderStatus('مدفوع')).toBe('SUCCESS');
    expect(classifyProviderStatus('Refunded')).toBe('FAILED');
    expect(classifyProviderStatus('partially refunded')).toBe('FAILED');
    expect(classifyProviderStatus('pending review')).toBe('UNKNOWN');
    expect(classifyProviderStatus(null)).toBe('UNKNOWN');
  });
});
