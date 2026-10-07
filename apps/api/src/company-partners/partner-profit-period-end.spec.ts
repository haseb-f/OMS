import { BadRequestException, type HttpException } from '@nestjs/common';
import { PartnerProfitService } from './partner-profit.service';

/** R14 fix — a profit period closes only after its last Africa/Cairo day. */
describe('PartnerProfitService.requirePeriodEnded', () => {
  const codeOf = (fn: () => void) => {
    try {
      fn();
      return null;
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as HttpException).getResponse() as {
        code?: string;
        message?: string;
      };
    }
  };

  it('refuses on the last day itself (Cairo), allows from the next Cairo day', () => {
    // 31 Oct 2026 21:59Z = 23:59 Cairo on the 31st (UTC+2 after DST ends).
    const refused = codeOf(() =>
      PartnerProfitService.requirePeriodEnded(
        '2026-10-31',
        new Date('2026-10-31T21:59:00Z'),
      ),
    );
    expect(refused?.code).toBe('PERIOD_NOT_ENDED');
    expect(refused?.message).toContain('2026-11-01');
    // 22:00Z = 00:00 Cairo on 1 Nov — the period is over.
    expect(
      codeOf(() =>
        PartnerProfitService.requirePeriodEnded(
          '2026-10-31',
          new Date('2026-10-31T22:00:00Z'),
        ),
      ),
    ).toBeNull();
  });

  it('refuses a period still running and one in the future', () => {
    const now = new Date('2026-10-07T09:00:00Z');
    expect(
      codeOf(() => PartnerProfitService.requirePeriodEnded('2026-12-31', now))
        ?.code,
    ).toBe('PERIOD_NOT_ENDED');
    expect(
      codeOf(() => PartnerProfitService.requirePeriodEnded('2026-09-30', now)),
    ).toBeNull();
  });
});
