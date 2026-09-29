import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReverseYearClosingDto } from './dto/close-year.dto';
import {
  OPENING_BALANCES_DERIVED,
  YearClosingService,
} from './year-closing.service';

describe('YearClosingService — opening balances are derived, never re-posted', () => {
  it('rejects nextFiscalYearId before touching any data', async () => {
    const prisma = {
      journalEntry: { findFirst: jest.fn(), create: jest.fn() },
      postingSettings: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const fiscalYears = { findOne: jest.fn() };
    const engine = { post: jest.fn(), reverse: jest.fn() };
    const service = new YearClosingService(
      prisma as never,
      {} as never,
      fiscalYears as never,
      engine as never,
    );

    const attempt = service.execute({
      fiscalYearId: '00000000-0000-4000-8000-000000000001',
      nextFiscalYearId: '00000000-0000-4000-8000-000000000002',
    });
    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toMatchObject({
      response: { code: OPENING_BALANCES_DERIVED },
    });
    expect(fiscalYears.findOne).not.toHaveBeenCalled();
    expect(engine.post).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns the existing active closing instead of posting a second one', async () => {
    const existing = { id: 'je-close', entryNumber: 'JV-1', lines: [] };
    const prisma = {
      journalEntry: { findFirst: jest.fn().mockResolvedValue(existing) },
      $transaction: jest.fn(),
    };
    const fiscalYears = {
      findOne: jest.fn().mockResolvedValue({
        id: 'fy-1',
        name: 'FY',
        status: 'CLOSED',
        startDate: new Date('2025-01-01'),
      }),
    };
    const engine = { post: jest.fn(), reverse: jest.fn() };
    const service = new YearClosingService(
      prisma as never,
      {} as never,
      fiscalYears as never,
      engine as never,
    );

    await expect(
      service.execute({ fiscalYearId: 'fy-1' }),
    ).resolves.toMatchObject({ closingEntry: existing, alreadyClosed: true });
    expect(engine.post).not.toHaveBeenCalled();
  });
});

describe('ReverseYearClosingDto — reason is trimmed before validation', () => {
  const check = async (reason: unknown) => {
    const dto = plainToInstance(ReverseYearClosingDto, { reason });
    return { dto, errors: await validate(dto) };
  };

  it('rejects a reason of only spaces', async () => {
    const { errors } = await check('     ');
    expect(errors.map((e) => e.property)).toEqual(['reason']);
  });

  it('rejects a reason that is too short once trimmed', async () => {
    const { errors } = await check('   abc   ');
    expect(errors).toHaveLength(1);
  });

  it('accepts and stores the trimmed reason', async () => {
    const { dto, errors } = await check('  Late supplier invoice  ');
    expect(errors).toHaveLength(0);
    expect(dto.reason).toBe('Late supplier invoice');
  });
});
