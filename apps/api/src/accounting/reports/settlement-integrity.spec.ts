import {
  evaluateSettlementIntegrity,
  type PartnerCurrencyBalanceView,
  type SettlementLineView,
} from './voucher-integrity';

const balance = (
  over: Partial<PartnerCurrencyBalanceView> = {},
): PartnerCurrencyBalanceView => ({
  side: 'AR',
  partnerId: 'p1',
  partnerName: 'P',
  currencyId: 'egp',
  currencyCode: 'EGP',
  functional: true,
  ledger: 100,
  agingNet: 100,
  ...over,
});
const line = (over: Partial<SettlementLineView> = {}): SettlementLineView => ({
  voucherId: 'v1',
  voucherNumber: 'CR-1',
  voucherType: 'CUSTOMER_RECEIPT',
  voucherStatus: 'CONFIRMED',
  partnerName: 'P',
  agentCollection: false,
  invoiceNumber: 'INV-1',
  allocatedAmount: 100,
  invoiceRemaining: null,
  ...over,
});
const codes = (input: Parameters<typeof evaluateSettlementIntegrity>[0]) =>
  evaluateSettlementIntegrity(input).map((issue) => [
    issue.code,
    issue.severity,
  ]);

describe('R22 settlement integrity rules', () => {
  it('functional currency: ledger must equal the aging net', () => {
    expect(codes({ balances: [balance()], lines: [] })).toEqual([]);
    expect(codes({ balances: [balance({ ledger: 150 })], lines: [] })).toEqual([
      ['PARTNER_AGING_MISMATCH', 'REVIEW'],
    ]);
  });

  it('foreign currency: only a residue with nothing open / unapplied is reported (amounts are not comparable otherwise)', () => {
    const foreign = { functional: false, currencyCode: 'SAR' };
    expect(
      codes({
        balances: [balance({ ...foreign, ledger: 0.01, agingNet: 0 })],
        lines: [],
      }),
    ).toEqual([]);
    expect(
      codes({
        balances: [balance({ ...foreign, ledger: -200, agingNet: 0 })],
        lines: [],
      }),
    ).toEqual([['PARTNER_AGING_MISMATCH', 'REVIEW']]);
    expect(
      codes({
        balances: [balance({ ...foreign, ledger: 1_000, agingNet: 100 })],
        lines: [],
      }),
    ).toEqual([]);
  });

  it('an agent collection allocated to an invoice and a cancelled voucher still allocated are errors', () => {
    expect(
      codes({ balances: [], lines: [line({ agentCollection: true })] }),
    ).toEqual([['AGENT_RECEIPT_ALLOCATED', 'ERROR']]);
    expect(
      codes({ balances: [], lines: [line({ voucherStatus: 'CANCELLED' })] }),
    ).toEqual([['CANCELLED_VOUCHER_ALLOCATED', 'ERROR']]);
  });

  it('a draft over-claiming an invoice is a review item (lines of one draft on one invoice summed)', () => {
    const draft = { voucherStatus: 'DRAFT', invoiceRemaining: 150 };
    expect(
      codes({
        balances: [],
        lines: [line({ ...draft, allocatedAmount: 150 })],
      }),
    ).toEqual([]);
    expect(
      codes({
        balances: [],
        lines: [
          line({ ...draft, allocatedAmount: 100 }),
          line({ ...draft, allocatedAmount: 100 }),
        ],
      }),
    ).toEqual([['DRAFT_OVER_CLAIM', 'REVIEW']]);
  });
});
