import { PostingEngineService } from './posting-engine.service';
import { JournalEntryStatus } from '@prisma/client';

describe('PostingEngineService idempotency', () => {
  it('returns the existing POSTED journal and does not rebuild entries on retry', async () => {
    const existing = {
      id: 'je-1',
      entryNumber: 'GJ-0001',
      status: JournalEntryStatus.POSTED,
    };
    const journalEntry = {
      findFirst: jest.fn().mockResolvedValue(existing),
    };
    const prisma = {
      journalEntry,
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ journalEntry }),
      ),
    };
    const numberingEngine = { next: jest.fn() };
    const activityService = { log: jest.fn() };
    const accountingPeriods = { assertPeriodOpen: jest.fn() };
    const fiscalYears = { assertPostingAllowed: jest.fn() };
    const service = new PostingEngineService(
      prisma as never,
      numberingEngine as never,
      activityService as never,
      accountingPeriods as never,
      fiscalYears as never,
    );
    const buildEntries = jest.fn();
    service.registerProvider({
      sourceTypes: ['SALES_INVOICE'],
      buildEntries,
    });

    const first = await service.post('SALES_INVOICE', 'inv-1', 'user-1');
    const second = await service.post('SALES_INVOICE', 'inv-1', 'user-1');

    expect(first).toEqual(existing);
    expect(second).toEqual(existing);
    expect(buildEntries).not.toHaveBeenCalled();
    expect(numberingEngine.next).not.toHaveBeenCalled();
  });
});

describe('PostingEngineService FX conversion', () => {
  const service = new PostingEngineService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const convert = (
    lines: Array<Record<string, unknown>>,
    rate: number | null,
  ): Array<{ debit?: number; credit?: number }> =>
    (
      service as unknown as {
        applyExchangeRate: (l: unknown, r: number | null) => never;
      }
    ).applyExchangeRate(lines, rate);

  it('keeps same-currency (rate 1 / no rate) postings unchanged', () => {
    const lines = [
      { accountId: 'cash', debit: 1300 },
      { accountId: 'ar', credit: 1300 },
    ];
    expect(convert(lines, 1)).toEqual(lines);
    expect(convert(lines, null)).toEqual(lines);
  });

  it('converts transaction-currency lines but never re-converts functional COGS/inventory', () => {
    // 1,000 units sold at 760 (foreign) with a moving-average cost of 400
    // already in functional currency; rate 0.5.
    const out = convert(
      [
        { accountId: 'ar', debit: 760000 },
        { accountId: 'revenue', credit: 760000 },
        { accountId: 'cogs', debit: 400000, functionalAmount: true },
        { accountId: 'inventory', credit: 400000, functionalAmount: true },
      ],
      0.5,
    );
    expect(out.map((l) => l.debit ?? l.credit)).toEqual([
      380000, 380000, 400000, 400000,
    ]);
  });
});
