import { BadRequestException, HttpException } from '@nestjs/common';
import { GoogleSheetsService } from '../google-sheets.service';
import { importRowHash, leadImportRowKey } from './import-row-key';
import { restrictedColumnWarnings } from './restricted-columns';
import { declarationKindFor, parseImportedOrderRows } from './store-order-rows';
import { describeJobRow, summarizeJobRows } from './import-job-summary';
import {
  NEEDS_REVIEW_PREFIX,
  NOTICE_PREFIX,
  SKIPPED_PREFIX,
} from '../import-type.interface';

const baseKey = {
  phone: '+966501234567',
  name: 'محمد أحمد',
  lines: [
    { productId: 'p1', quantity: 2, amount: 200 },
    { productId: 'p2', quantity: 1, amount: 50 },
  ],
  orderDate: '2026-10-01',
  externalId: 'SH-1',
};

describe('R15 sales import — row key (D15-17)', () => {
  it('ignores cell formatting: name spacing / Arabic letter forms, line order, external id case', () => {
    const a = importRowHash('company', baseKey);
    const b = importRowHash('company', {
      ...baseKey,
      name: '  محمد   احمد ',
      lines: [...baseKey.lines].reverse(),
      externalId: ' sh-1 ',
    });
    expect(b).toBe(a);
  });

  it('a genuine repeat order (another date, quantity, amount or external id) hashes differently', () => {
    const a = importRowHash('company', baseKey);
    expect(
      importRowHash('company', { ...baseKey, orderDate: '2026-10-02' }),
    ).not.toBe(a);
    expect(
      importRowHash('company', { ...baseKey, externalId: 'SH-2' }),
    ).not.toBe(a);
    expect(
      importRowHash('company', {
        ...baseKey,
        lines: [{ productId: 'p1', quantity: 3, amount: 300 }],
      }),
    ).not.toBe(a);
  });

  it('is scoped: the same row of two agents (or company vs agent) never collides', () => {
    expect(importRowHash('agent:a', baseKey)).not.toBe(
      importRowHash('agent:b', baseKey),
    );
    expect(importRowHash('company', baseKey)).not.toBe(
      importRowHash('agent:a', baseKey),
    );
    expect(leadImportRowKey('company', 'abc')).toBe('lead-import:company:abc');
  });
});

describe('R15 sales import — restricted columns (2.12)', () => {
  it('warns for agent / shipping / payment-verification / cost columns that are not mapped', () => {
    const warnings = restrictedColumnWarnings(
      [
        'Customer Name',
        'Agent',
        'Tracking Number',
        'حالة الدفع',
        'Commission',
        'Phone',
      ],
      { customerName: 'Customer Name', customerPhone: 'Phone' },
    );
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toContain('"Agent"');
    expect(warnings.join(' ')).toContain('Tracking Number');
  });

  it('never warns for a mapped column', () => {
    expect(restrictedColumnWarnings(['Agent'], { notes: 'Agent' })).toEqual([]);
  });
});

describe('R15 sales import — order rows (explicit prices, declaration)', () => {
  const row = (over: Record<string, string> = {}) => ({
    customerName: 'Customer',
    customerPhone: '0501234567',
    orderDate: '2026-10-01',
    productSku: 'SKU-1',
    quantity: '2',
    ...over,
  });

  it('needs an explicit price (Unit Price or Line Amount) — never derived from Paid Amount', () => {
    expect(() => parseImportedOrderRows([row({ paidAmount: '100' })])).toThrow(
      BadRequestException,
    );
    expect(
      parseImportedOrderRows([row({ unitPrice: '50' })]).lines[0].lineAmount,
    ).toBe(100);
    expect(
      parseImportedOrderRows([row({ lineAmount: '٩٠' })]).lines[0].lineAmount,
    ).toBe(90);
  });

  it('refuses a Unit Price × Quantity that disagrees with Line Amount', () => {
    expect(() =>
      parseImportedOrderRows([row({ unitPrice: '50', lineAmount: '90' })]),
    ).toThrow(/Line Amount/);
  });

  it('sums the paid amount of the order rows and reads the repeat flag', () => {
    const parsed = parseImportedOrderRows([
      row({ unitPrice: '50', paidAmount: '60', repeatCustomer: 'نعم' }),
      row({ productSku: 'SKU-2', lineAmount: '40', paidAmount: '40' }),
    ]);
    expect(parsed.paidAmount).toBe(100);
    expect(parsed.repeatCustomer).toBe(true);
    expect(() =>
      parseImportedOrderRows([row({ unitPrice: '1', repeatCustomer: 'ربما' })]),
    ).toThrow(/Repeat Customer/);
  });

  it('maps a paid amount to a declaration kind, never above the total', () => {
    expect(declarationKindFor(0, 100)).toEqual({ kind: 'UNPAID' });
    expect(declarationKindFor(100, 100)).toEqual({ kind: 'FULL' });
    expect(declarationKindFor(40, 100)).toEqual({
      kind: 'PARTIAL',
      amount: 40,
    });
    expect(() => declarationKindFor(120, 100)).toThrow(/exceeds/);
  });
});

describe('R15 sales import — run summary', () => {
  it('splits stored outcomes into created / skipped / needs review / rejected', () => {
    const rows = [
      { errorMessage: `${SKIPPED_PREFIX}Already imported`, rejectedAt: null },
      { errorMessage: `${NOTICE_PREFIX}Awaits stock`, rejectedAt: null },
      { errorMessage: `${NEEDS_REVIEW_PREFIX}Phone match`, rejectedAt: null },
      {
        errorMessage: `${NEEDS_REVIEW_PREFIX}Phone match`,
        rejectedAt: new Date(),
      },
      { errorMessage: 'Invalid phone', rejectedAt: null },
    ];
    expect(summarizeJobRows(rows, 3)).toEqual({
      created: 3,
      skipped: 1,
      needsReview: 1,
      rejected: 2,
      notices: 1,
    });
    expect(describeJobRow(rows[0])).toEqual({
      outcome: 'SKIPPED',
      reason: 'Already imported',
    });
  });
});

describe('R15 Google Sheets access message (D15-17)', () => {
  it('a 403 names the service-account address to share with as Viewer — never asks for a public sheet', () => {
    const previous = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
      client_email: 'oms-reader@test.iam.gserviceaccount.com',
      private_key: 'test-key',
    });
    try {
      const service = new GoogleSheetsService();
      expect(service.serviceAccountEmail()).toBe(
        'oms-reader@test.iam.gserviceaccount.com',
      );
      const error = (
        service as unknown as { mapError(error: unknown): HttpException }
      ).mapError({ code: 403 });
      const body = error.getResponse() as { message: string };
      expect(body).toMatchObject({
        code: 'GOOGLE_SHEET_ACCESS_DENIED',
        serviceAccountEmail: 'oms-reader@test.iam.gserviceaccount.com',
      });
      expect(body.message).toContain('as Viewer');
      expect(body.message).toContain('never needs to be public');
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
      else process.env.GOOGLE_SERVICE_ACCOUNT_KEY = previous;
    }
  });
});
