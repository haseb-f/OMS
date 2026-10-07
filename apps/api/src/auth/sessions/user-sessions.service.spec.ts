import { JwtService } from '@nestjs/jwt';
import {
  UserSessionsService,
  sessionAbsoluteHours,
} from './user-sessions.service';

describe('UserSessionsService — absolute session length', () => {
  it('defaults to 12 h and only accepts 0 < hours <= 24', () => {
    expect(sessionAbsoluteHours(undefined)).toBe(12);
    expect(sessionAbsoluteHours('8')).toBe(8);
    expect(sessionAbsoluteHours('0')).toBe(12);
    expect(sessionAbsoluteHours('48')).toBe(12);
    expect(sessionAbsoluteHours('abc')).toBe(12);
  });

  it('signs a 12 h token even when the module-wide JWT TTL is 15 m (Production)', async () => {
    // The module default mirrors Production's JWT_ACCESS_TTL=15m.
    const jwt = new JwtService({
      secret: 'test-secret',
      signOptions: { expiresIn: '15m' },
    });
    const create = jest.fn().mockResolvedValue({});
    const service = new UserSessionsService(
      { userSession: { create } } as never,
      jwt,
    );
    const token = await service.issueAccessToken({ sub: 'u1', email: 'a@b.c' });
    const { iat, exp, sid } = jwt.decode<{
      iat: number;
      exp: number;
      sid: string;
    }>(token);
    expect(exp - iat).toBe(12 * 3600);
    const row = (
      create.mock.calls[0] as [{ data: { id: string; expiresAt: Date } }]
    )[0].data;
    expect(row.id).toBe(sid);
    expect(row.expiresAt.getTime()).toBe(exp * 1000);
  });
});
