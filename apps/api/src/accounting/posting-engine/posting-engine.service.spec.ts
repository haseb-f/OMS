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
