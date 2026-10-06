import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import type { NumberingEngineService } from '../numbering/numbering-engine.service';
import { PhoneNumberService } from '../common/phone/phone-number.service';
import { PartnersService } from './partners.service';

/**
 * R13 A1 — a partner phone is always stored as a full E.164. Without a
 * country it is read through the R11 one path (`lookupCandidates`) and a
 * value with no valid reading is rejected (400) instead of stored raw.
 */
describe('PartnersService.normalizePartnerPhone', () => {
  const countries: Record<string, { id: string; code: string }> = {
    eg: { id: 'eg', code: 'EG' },
    sa: { id: 'sa', code: 'SA' },
  };
  const prisma = {
    country: {
      findFirst: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(countries[where.id] ?? null),
      ),
    },
  } as unknown as PrismaService;
  const service = new PartnersService(
    prisma,
    {} as MasterDataActivityLogService,
    {} as NumberingEngineService,
    new PhoneNumberService(),
  );

  it('keeps a +966 number when the address country is Egypt (phone and address countries may differ)', async () => {
    await expect(
      service.normalizePartnerPhone('+966 50 123 4567', 'eg'),
    ).resolves.toBe('+966501234567');
  });

  it('reads a number without a country through the one lookup path', async () => {
    await expect(
      service.normalizePartnerPhone('+201001234567', null),
    ).resolves.toBe('+201001234567');
    await expect(
      service.normalizePartnerPhone('00966501234567', null),
    ).resolves.toBe('+966501234567');
    // A bare national number with exactly one valid primary-market reading.
    await expect(
      service.normalizePartnerPhone('01001234567', undefined),
    ).resolves.toBe('+201001234567');
  });

  it('refuses to guess a bare number that is valid in several markets — the user chooses the calling code', async () => {
    const error = await service
      .normalizePartnerPhone('0501234567', undefined)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as {
      code: string;
      message: string;
    };
    expect(body.code).toBe('PHONE_AMBIGUOUS');
    expect(body.message).toContain('+966501234567');
    expect(body.message).toContain('+971501234567');
    // With the calling code chosen, the same digits are accepted.
    await expect(
      service.normalizePartnerPhone('0501234567', 'sa'),
    ).resolves.toBe('+966501234567');
  });

  it('rejects a value with no valid reading instead of storing raw text', async () => {
    await expect(
      service.normalizePartnerPhone('12345', null),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.normalizePartnerPhone('call me', null),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps an untouched legacy value already stored on the record', async () => {
    await expect(
      service.normalizePartnerPhone('12345', null, ['12345', null]),
    ).resolves.toBe('12345');
  });

  it('empty stays empty', async () => {
    await expect(
      service.normalizePartnerPhone('  ', null),
    ).resolves.toBeUndefined();
  });
});
