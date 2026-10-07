import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import type { DepartmentsService } from '../departments/departments.service';
import { PhoneNumberService } from '../common/phone/phone-number.service';
import { UsersService } from './users.service';
import type { UserSessionsService } from '../auth/sessions/user-sessions.service';

/**
 * A user's mobile has no country selector: a number with one valid reading is
 * stored as E.164; a bare number valid in several fallback markets is refused
 * (400 PHONE_AMBIGUOUS) instead of guessing the first market.
 */
describe('UsersService mobile normalization', () => {
  const service = new UsersService(
    {} as PrismaService,
    {} as PermissionsResolverService,
    new PhoneNumberService(),
    {} as DepartmentsService,
    {} as UserSessionsService,
  );
  const normalize = (value: string) =>
    (
      service as unknown as {
        normalizeUserMobile: (v: string) => string | undefined;
      }
    ).normalizeUserMobile(value);

  it('accepts an international number and a single unambiguous reading', () => {
    expect(normalize('+966 50 123 4567')).toBe('+966501234567');
    expect(normalize('01001234567')).toBe('+201001234567');
  });

  it('refuses a bare number valid in more than one market', () => {
    let error: unknown;
    try {
      normalize('0501234567');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'PHONE_AMBIGUOUS',
      fields: [{ field: 'mobile', constraints: ['ambiguous_country'] }],
    });
  });

  it('still rejects a value with no valid reading', () => {
    expect(() => normalize('12345')).toThrow(BadRequestException);
  });
});
