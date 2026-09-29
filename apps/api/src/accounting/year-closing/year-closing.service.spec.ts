import { BadRequestException } from '@nestjs/common';
import {
  CARRY_FORWARD_DISABLED,
  YearClosingService,
} from './year-closing.service';

describe('YearClosingService — carry-forward is refused (fail-closed)', () => {
  it('rejects nextFiscalYearId before touching any data', async () => {
    const prisma = {
      journalEntry: { findFirst: jest.fn(), create: jest.fn() },
      postingSettings: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const fiscalYears = { findOne: jest.fn() };
    const reports = { incomeStatement: jest.fn() };
    const service = new YearClosingService(
      prisma as never,
      {} as never,
      {} as never,
      fiscalYears as never,
      reports as never,
    );

    const attempt = service.execute({
      fiscalYearId: '00000000-0000-4000-8000-000000000001',
      nextFiscalYearId: '00000000-0000-4000-8000-000000000002',
    });
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toMatchObject({
      response: { code: CARRY_FORWARD_DISABLED },
    });
    expect(fiscalYears.findOne).not.toHaveBeenCalled();
    expect(reports.incomeStatement).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
