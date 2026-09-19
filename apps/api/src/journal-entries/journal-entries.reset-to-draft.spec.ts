import { BadRequestException } from '@nestjs/common';
import { JournalEntryStatus } from '@prisma/client';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntryActivityType } from './activities/journal-entry-activity.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('JournalEntriesService.resetToDraft', () => {
  const postedAt = new Date('2026-09-01T12:00:00.000Z');
  const manualPosted = {
    id: 'je-manual',
    entryNumber: 'GJ-1001',
    status: JournalEntryStatus.POSTED,
    sourceType: 'MANUAL',
    totalDebit: 25,
    totalCredit: 25,
    entryDate: new Date('2026-09-01'),
    postedAt,
    postedBy: 'user-1',
    reversalOfEntryId: null,
    reversedByEntry: null,
    lines: [],
    journal: { id: 'j-1' },
  };

  type Existing = Omit<typeof manualPosted, 'status'> & {
    status: JournalEntryStatus;
  };

  function makeService(existing: Existing) {
    const tx = {
      journalEntry: {
        update: jest.fn().mockImplementation(() =>
          Promise.resolve({
            ...existing,
            status: JournalEntryStatus.DRAFT,
            postedAt: null,
            postedBy: null,
          }),
        ),
      },
    };
    const prisma = {
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue(existing),
      },
      $transaction: jest.fn((cb: (client: typeof tx) => unknown) => cb(tx)),
    };
    const activityService = { log: jest.fn().mockResolvedValue(undefined) };
    const accountingPeriods = {
      assertPeriodOpen: jest.fn().mockResolvedValue(undefined),
    };
    const fiscalYears = {
      assertPostingAllowed: jest.fn(),
      resolveFiscalYearId: jest.fn(),
    };
    const service = new JournalEntriesService(
      prisma as unknown as PrismaService,
      activityService as never,
      { generateNumber: jest.fn() } as never,
      accountingPeriods as never,
      fiscalYears as never,
    );
    return { service, prisma, tx, activityService, accountingPeriods };
  }

  it('returns a posted MANUAL journal to Draft and writes ENTRY_UNPOSTED', async () => {
    const { service, tx, activityService, accountingPeriods } =
      makeService(manualPosted);

    await expect(
      service.resetToDraft(manualPosted.id, 'user-2'),
    ).resolves.toEqual(
      expect.objectContaining({ status: JournalEntryStatus.DRAFT }),
    );
    expect(accountingPeriods.assertPeriodOpen).toHaveBeenCalledWith(
      manualPosted.entryDate,
      tx,
    );
    const updateArg = (
      tx.journalEntry.update as jest.Mock<
        unknown,
        [{ where: { id: string }; data: Record<string, unknown> }]
      >
    ).mock.calls[0]?.[0];
    expect(updateArg?.where.id).toBe(manualPosted.id);
    expect(updateArg?.data).toMatchObject({
      status: JournalEntryStatus.DRAFT,
      postedAt: null,
      postedBy: null,
      updatedBy: 'user-2',
    });
    expect(activityService.log).toHaveBeenCalledWith(
      manualPosted.id,
      JournalEntryActivityType.ENTRY_UNPOSTED,
      expect.stringContaining('returned to Draft'),
      expect.objectContaining({ previousPostedAt: postedAt }),
      tx,
    );
  });

  it('rejects system-generated journals', async () => {
    const { service, tx } = makeService({
      ...manualPosted,
      sourceType: 'SALES_INVOICE',
    });

    await expect(
      service.resetToDraft(manualPosted.id, 'user-2'),
    ).rejects.toThrow(BadRequestException);
    expect(tx.journalEntry.update).not.toHaveBeenCalled();
  });

  it('rejects journals that are not POSTED', async () => {
    const { service, tx } = makeService({
      ...manualPosted,
      status: JournalEntryStatus.DRAFT,
    });

    await expect(service.resetToDraft(manualPosted.id)).rejects.toThrow(
      /from DRAFT/,
    );
    expect(tx.journalEntry.update).not.toHaveBeenCalled();
  });

  it('rejects a reversal pair', async () => {
    const { service, tx } = makeService({
      ...manualPosted,
      reversedByEntry: { id: 'je-rev', entryNumber: 'GJ-1002' } as never,
    });

    await expect(service.resetToDraft(manualPosted.id)).rejects.toThrow(
      /reversal pair/,
    );
    expect(tx.journalEntry.update).not.toHaveBeenCalled();
  });
});
