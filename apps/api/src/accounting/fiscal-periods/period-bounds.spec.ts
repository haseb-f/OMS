import { BadRequestException } from '@nestjs/common';
import { AccountingPeriodStatus } from '@prisma/client';
import { AccountingPeriodsService } from './accounting-periods.service';
import { coversInstant, exclusiveEnd } from './period-bounds';

// Monthly periods generated with server-local midnight endDates (the stored shape).
type TestPeriod = {
  name: string;
  startDate: Date;
  endDate: Date;
  status: AccountingPeriodStatus;
};
const sep: TestPeriod = {
  name: 'Sep 2026',
  startDate: new Date(2026, 8, 1),
  endDate: new Date(2026, 8, 30),
  status: AccountingPeriodStatus.CLOSED,
};
const oct: TestPeriod = {
  name: 'Oct 2026',
  startDate: new Date(2026, 9, 1),
  endDate: new Date(2026, 9, 31),
  status: AccountingPeriodStatus.OPEN,
};

function serviceWith(periods: TestPeriod[]) {
  const client = {
    accountingPeriod: {
      findFirst: jest.fn(({ where }: { where: { startDate: { lte: Date } } }) =>
        Promise.resolve(
          [...periods]
            .filter((p) => p.startDate <= where.startDate.lte)
            .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0] ??
            null,
        ),
      ),
    },
  };
  return { service: new AccountingPeriodsService(client as never), client };
}

describe('period bounds — last day of a period', () => {
  it('an instant during the last day belongs to that period', () => {
    expect(coversInstant(sep, new Date(2026, 8, 30, 15, 0))).toBe(true);
    expect(coversInstant(sep, new Date(2026, 9, 1, 0, 0))).toBe(false);
    expect(exclusiveEnd(sep)).toEqual(new Date(2026, 9, 1));
  });

  it('blocks a posting at 15:00 on the last day of a CLOSED period (was silently allowed)', async () => {
    const { service } = serviceWith([sep, oct]);
    await expect(
      service.assertPeriodOpen(new Date(2026, 8, 30, 15, 0)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the first instant of the next (open) period is allowed', async () => {
    const { service } = serviceWith([sep, oct]);
    await expect(
      service.assertPeriodOpen(new Date(2026, 9, 1, 0, 0)),
    ).resolves.toBeUndefined();
  });

  it('a date with no period set up stays permissive', async () => {
    const { service } = serviceWith([sep]);
    await expect(
      service.assertPeriodOpen(new Date(2026, 10, 5)),
    ).resolves.toBeUndefined();
  });
});
