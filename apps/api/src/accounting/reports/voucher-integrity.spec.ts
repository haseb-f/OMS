import {
  evaluateVoucherIntegrity,
  type VoucherView,
} from './voucher-integrity';

const voucher = (over: Partial<VoucherView> = {}): VoucherView => ({
  id: 'v1',
  transactionNumber: 'CR-1',
  type: 'CUSTOMER_RECEIPT',
  status: 'CONFIRMED',
  amount: 100,
  feeAmount: 0,
  exchangeRate: 1,
  cashAccountId: 'bank',
  partnerName: 'P',
  storeOrderReceipt: false,
  allocations: [{ allocatedAmount: 100, invoiceNumber: 'INV-1' }],
  ...over,
});
const entry = (
  debitBank: number,
  extra: Partial<{ reversalOfEntryId: string }> = {},
) => ({
  sourceId: 'v1',
  reversalOfEntryId: extra.reversalOfEntryId ?? null,
  reversed: false,
  lines: [
    { accountId: 'bank', debit: debitBank, credit: 0 },
    { accountId: 'ar', debit: 0, credit: debitBank },
  ],
});
const codes = (input: Parameters<typeof evaluateVoucherIntegrity>[0]) =>
  evaluateVoucherIntegrity(input).map((issue) => issue.code);
const empty = { invoices: [], bankMatches: [] };

describe('evaluateVoucherIntegrity (R18)', () => {
  it('a consistent voucher raises nothing', () => {
    expect(
      codes({ vouchers: [voucher()], entries: [entry(100)], ...empty }),
    ).toEqual([]);
  });

  it('flags the R18 shape for review: 200,000 received, 100,000 applied', () => {
    const issues = evaluateVoucherIntegrity({
      vouchers: [
        voucher({
          amount: 200_000,
          allocations: [{ allocatedAmount: 100_000, invoiceNumber: 'INV-91' }],
        }),
      ],
      entries: [entry(200_000)],
      ...empty,
    });
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'PARTIAL_WITH_UNAPPLIED',
        severity: 'REVIEW',
        amounts: { amount: 200_000, allocated: 100_000, unapplied: 100_000 },
      }),
    ]);
  });

  it('store-order receipts and plain advances are not review items', () => {
    expect(
      codes({
        vouchers: [
          voucher({ amount: 150, storeOrderReceipt: true }),
          voucher({ id: 'v2', amount: 50, allocations: [] }),
        ],
        entries: [entry(150), { ...entry(50), sourceId: 'v2' }],
        ...empty,
      }),
    ).toEqual([]);
  });

  it('over-allocation, missing / duplicate entries and a wrong cash line are errors', () => {
    expect(
      codes({
        vouchers: [
          voucher({
            allocations: [{ allocatedAmount: 150, invoiceNumber: 'X' }],
          }),
        ],
        entries: [entry(100)],
        ...empty,
      }),
    ).toEqual(['VOUCHER_OVER_ALLOCATED']);
    expect(codes({ vouchers: [voucher()], entries: [], ...empty })).toEqual([
      'ENTRY_MISSING',
    ]);
    expect(
      codes({
        vouchers: [voucher()],
        entries: [entry(100), entry(100)],
        ...empty,
      }),
    ).toEqual(['ENTRY_DUPLICATED']);
    expect(
      codes({ vouchers: [voucher()], entries: [entry(90)], ...empty }),
    ).toEqual(['CASH_LINE_MISMATCH']);
    // A receiving account re-mapped after posting (no line on it) is not compared.
    expect(
      codes({
        vouchers: [voucher({ cashAccountId: 'bank-2' })],
        entries: [entry(100)],
        ...empty,
      }),
    ).toEqual([]);
  });

  it('a reversed-and-reposted voucher counts only its active entry; a cancelled one must have none', () => {
    expect(
      codes({
        vouchers: [voucher()],
        entries: [entry(100), entry(100, { reversalOfEntryId: 'e0' })],
        ...empty,
      }),
    ).toEqual([]);
    expect(
      codes({
        vouchers: [voucher({ status: 'CANCELLED' })],
        entries: [],
        ...empty,
      }),
    ).toEqual([]);
    expect(
      codes({
        vouchers: [voucher({ status: 'CANCELLED' })],
        entries: [entry(100)],
        ...empty,
      }),
    ).toEqual(['CANCELLED_ENTRY_ACTIVE']);
  });

  it('a supplier payment checks the credit side of the bank', () => {
    const payment = voucher({ type: 'SUPPLIER_PAYMENT' });
    const posted = {
      sourceId: 'v1',
      reversalOfEntryId: null,
      reversed: false,
      lines: [
        { accountId: 'ap', debit: 100, credit: 0 },
        { accountId: 'bank', debit: 0, credit: 100 },
      ],
    };
    expect(codes({ vouchers: [payment], entries: [posted], ...empty })).toEqual(
      [],
    );
  });

  it('invoice over-allocation and bank matches of a different amount are errors', () => {
    expect(
      codes({
        vouchers: [],
        entries: [],
        invoices: [
          {
            documentType: 'SALES_INVOICE',
            id: 'i',
            invoiceNumber: 'INV',
            partnerName: null,
            grandTotal: 100,
            allocatedTotal: 120,
          },
        ],
        bankMatches: [
          {
            id: 'b1',
            reference: 'T1',
            bankAmount: 100_000,
            documentNumber: 'PAY-1',
            documentAmount: 200_000,
          },
          {
            id: 'b2',
            reference: 'T2',
            bankAmount: -50,
            documentNumber: 'SP-1',
            documentAmount: 50,
          },
        ],
      }),
    ).toEqual(['INVOICE_OVER_ALLOCATED', 'BANK_MATCH_AMOUNT_MISMATCH']);
  });
});
