import { BadRequestException } from '@nestjs/common';
import { AccountingPeriodStatus, FiscalYearStatus } from '@prisma/client';
import { AccountingPeriodsService } from './accounting-periods.service';
import { FiscalYearsService } from './fiscal-years.service';
import {
  coversInstant,
  exclusiveEnd,
  pickCovering,
  rangeDateOf,
  rangeStart,
} from './period-bounds';
import { closingDateOf } from '../year-closing/year-closing-posting.provider';
import { businessDateRangeFilter } from '../../common/time/business-date';

/**
 * Period / fiscal-year membership = the instant's Africa/Cairo business
 * date (decisions-round2.md §R2, §Y9), so locks, the Year Closing cutoff
 * and the reports agree. All instants below are explicit UTC.
 */
type Range = {
  name: string;
  startDate: Date;
  endDate: Date;
  status: AccountingPeriodStatus;
};
const utc = (iso: string) => new Date(iso);
const range = (
  name: string,
  start: string,
  end: string,
  status: AccountingPeriodStatus = AccountingPeriodStatus.OPEN,
): Range => ({ name, startDate: utc(start), endDate: utc(end), status });

// The three stored shapes of a bound: date-only 00:00Z, server-local
// midnight on a UTC+3 host (legacy generated periods), end-of-day marker.
const sepDateOnly = range(
  'Sep',
  '2026-09-01T00:00:00Z',
  '2026-09-30T00:00:00Z',
  AccountingPeriodStatus.CLOSED,
);
const octDateOnly = range(
  'Oct',
  '2026-10-01T00:00:00Z',
  '2026-10-31T00:00:00Z',
);
const sepLegacy = range(
  'Sep',
  '2026-08-31T21:00:00Z',
  '2026-09-29T21:00:00Z',
  AccountingPeriodStatus.CLOSED,
);
const octLegacy = range('Oct', '2026-09-30T21:00:00Z', '2026-10-30T21:00:00Z');

function periodsService(periods: Range[]) {
  const client = {
    accountingPeriod: {
      findMany: jest.fn(({ where }: { where: { startDate: { lte: Date } } }) =>
        Promise.resolve(
          periods
            .filter((p) => p.startDate <= where.startDate.lte)
            .sort((a, b) => b.startDate.getTime() - a.startDate.getTime()),
        ),
      ),
    },
  };
  return new AccountingPeriodsService(client as never);
}

describe('period bounds — stored bound shapes', () => {
  it('recovers the named calendar date from every stored shape', () => {
    expect(rangeDateOf(utc('2026-10-01T00:00:00Z'))).toBe('2026-10-01');
    expect(rangeDateOf(utc('2026-09-30T21:00:00Z'))).toBe('2026-10-01');
    expect(rangeDateOf(utc('2026-12-31T23:59:59.999Z'))).toBe('2026-12-31');
    expect(rangeDateOf(utc('2026-12-31T21:59:59.999Z'))).toBe('2026-12-31');
    expect(rangeDateOf(utc('2026-10-01T05:00:00Z'))).toBe('2026-10-01');
  });

  it('query bounds are Cairo business-day instants (same as the reports)', () => {
    expect(rangeStart(octDateOnly)).toEqual(utc('2026-09-30T21:00:00Z'));
    expect(exclusiveEnd(sepDateOnly)).toEqual(utc('2026-09-30T21:00:00Z'));
    expect({
      gte: rangeStart(octDateOnly),
      lt: exclusiveEnd(octDateOnly),
    }).toEqual(businessDateRangeFilter('2026-10-01', '2026-10-31'));
  });
});

describe('period membership — 00:30 Cairo on 1 Oct (2026-09-30T21:30Z)', () => {
  const instant = utc('2026-09-30T21:30:00Z');

  it.each([
    ['date-only bounds', sepDateOnly, octDateOnly],
    ['legacy server-local bounds', sepLegacy, octLegacy],
  ])('belongs to October, not September (%s)', (_label, sep, oct) => {
    expect(coversInstant(sep, instant)).toBe(false);
    expect(coversInstant(oct, instant)).toBe(true);
    expect(pickCovering([oct, sep], instant)?.name).toBe('Oct');
  });

  it('locking: allowed while October is open although September is closed', async () => {
    await expect(
      periodsService([sepDateOnly, octDateOnly]).assertPeriodOpen(instant),
    ).resolves.toBeUndefined();
  });

  it('locking: 23:59 Cairo on 30 Sep (20:59Z) is still September → blocked', async () => {
    await expect(
      periodsService([sepDateOnly, octDateOnly]).assertPeriodOpen(
        utc('2026-09-30T20:59:00Z'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reporting: the October report range contains it, September does not', () => {
    const oct = businessDateRangeFilter('2026-10-01', '2026-10-31');
    const sep = businessDateRangeFilter('2026-09-01', '2026-09-30');
    expect(instant >= oct.gte! && instant < oct.lt!).toBe(true);
    expect(instant >= sep.gte! && instant < sep.lt!).toBe(false);
  });

  it('a date with no period set up stays permissive', async () => {
    await expect(
      periodsService([sepDateOnly]).assertPeriodOpen(
        utc('2026-11-05T10:00:00Z'),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('period membership — Egyptian DST days', () => {
  it('spring forward (24 Apr 2026, 00:00 → 01:00): 21:59Z is 23 Apr, 22:00Z is 24 Apr', () => {
    const upTo23 = range(
      'to 23 Apr',
      '2026-04-01T00:00:00Z',
      '2026-04-23T00:00:00Z',
    );
    const from24 = range(
      'from 24 Apr',
      '2026-04-24T00:00:00Z',
      '2026-04-30T00:00:00Z',
    );
    expect(
      pickCovering([from24, upTo23], utc('2026-04-23T21:59:00Z'))?.name,
    ).toBe('to 23 Apr');
    expect(
      pickCovering([from24, upTo23], utc('2026-04-23T22:00:00Z'))?.name,
    ).toBe('from 24 Apr');
  });

  it('fall back (end of 29 Oct 2026, 24:00 → 23:00): 21:30Z is still 29 Oct, 22:00Z is 30 Oct', () => {
    const upTo29 = range(
      'to 29 Oct',
      '2026-10-01T00:00:00Z',
      '2026-10-29T00:00:00Z',
    );
    const from30 = range(
      'from 30 Oct',
      '2026-10-30T00:00:00Z',
      '2026-10-31T00:00:00Z',
    );
    expect(
      pickCovering([from30, upTo29], utc('2026-10-29T21:30:00Z'))?.name,
    ).toBe('to 29 Oct');
    expect(
      pickCovering([from30, upTo29], utc('2026-10-29T22:00:00Z'))?.name,
    ).toBe('from 30 Oct');
  });
});

describe('fiscal year — 31 Dec → 1 Jan (the Year Closing cutoff)', () => {
  const fy2025 = {
    id: 'fy-2025',
    name: 'FY 2025',
    startDate: utc('2025-01-01T00:00:00Z'),
    endDate: utc('2025-12-31T23:59:59.999Z'),
    status: FiscalYearStatus.CLOSED,
  };
  const fy2026 = {
    id: 'fy-2026',
    name: 'FY 2026',
    startDate: utc('2026-01-01T00:00:00Z'),
    endDate: utc('2026-12-31T00:00:00Z'),
    status: FiscalYearStatus.OPEN,
  };
  const service = new FiscalYearsService({
    fiscalYear: {
      findMany: jest.fn(() => Promise.resolve([fy2026, fy2025])),
    },
    journalEntry: {
      findFirst: jest.fn(() => Promise.resolve({ id: 'opening' })),
    },
  } as never);

  it('00:30 Cairo on 1 Jan (2025-12-31T22:30Z) belongs to FY 2026 and may post', async () => {
    await expect(
      service.resolveFiscalYearId(utc('2025-12-31T22:30:00Z')),
    ).resolves.toBe('fy-2026');
    await expect(
      service.assertPostingAllowed(utc('2025-12-31T22:30:00Z'), 'MANUAL'),
    ).resolves.toBeUndefined();
  });

  it('23:30 Cairo on 31 Dec (21:30Z) belongs to the closed FY 2025 → blocked', async () => {
    await expect(
      service.assertPostingAllowed(utc('2025-12-31T21:30:00Z'), 'MANUAL'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the closing entry is dated inside FY 2025 and the closing cutoff is the Cairo end of 31 Dec', () => {
    const closingDate = closingDateOf(fy2025);
    expect(closingDate).toEqual(utc('2025-12-31T00:00:00Z'));
    expect(coversInstant(fy2025, closingDate)).toBe(true);
    // The closing sums [FY start, 31 Dec] by business day — the same
    // instants the lock uses — so 22:30Z on 31 Dec is left for FY 2026.
    const cutoff = businessDateRangeFilter(
      '2025-01-01',
      rangeDateOf(fy2025.endDate),
    );
    expect(cutoff.lt).toEqual(exclusiveEnd(fy2025));
    expect(cutoff.lt).toEqual(utc('2025-12-31T22:00:00Z'));
  });
});
