import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  LAST_SEEN_WRITE_INTERVAL_MS,
  SESSION_CACHE_TTL_MS,
  UserSessionsService,
} from '../sessions/user-sessions.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * R14 W1 (spec-1 §2) — every token is bound to a live server-side session:
 * missing / revoked / idle / expired sessions and inactive, locked or deleted
 * users are refused with 401, for internal tokens as much as agent tokens.
 */
describe('JwtAuthGuard — server-side sessions', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  const userId = '22222222-2222-4222-8222-222222222222';
  const sid = '44444444-4444-4444-8444-444444444444';
  const MINUTE = 60_000;

  let findUnique: jest.Mock;
  let updateMany: jest.Mock;
  let sessions: UserSessionsService;
  let guard: JwtAuthGuard;

  function ctx(token: string) {
    const handler = () => undefined;
    const clazz = class {};
    const request = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as Request;
    return {
      getHandler: () => handler,
      getClass: () => clazz,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function sessionRow(patch: Record<string, unknown> = {}) {
    return {
      userId,
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * MINUTE),
      revokedAt: null,
      user: { isActive: true, isLocked: false, deletedAt: null },
      ...patch,
    };
  }

  const token = (claims: Record<string, unknown> = { sid }) =>
    jwt.sign({ sub: userId, email: 'i@x.test', ...claims });

  async function rejection(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      return (
        (error as UnauthorizedException).getResponse() as { code: string }
      ).code;
    }
    throw new Error('expected the guard to reject');
  }

  beforeEach(() => {
    delete process.env.SESSION_IDLE_MINUTES;
    findUnique = jest.fn().mockResolvedValue(sessionRow());
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      userSession: { findUnique, updateMany },
      user: { findFirst: jest.fn() },
    } as unknown as PrismaService;
    sessions = new UserSessionsService(prisma, jwt);
    guard = new JwtAuthGuard(jwt, new Reflector(), prisma, sessions);
  });

  it('admits a token whose session is live', async () => {
    await expect(guard.canActivate(ctx(token()))).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: sid } }),
    );
  });

  it('refuses a token without a session id (issued before R14)', async () => {
    expect(await rejection(guard.canActivate(ctx(token({}))))).toBe(
      'SESSION_MISSING',
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('refuses an unknown session and a session of another user', async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await rejection(guard.canActivate(ctx(token())))).toBe(
      'SESSION_MISSING',
    );
    findUnique.mockResolvedValueOnce(
      sessionRow({ userId: '99999999-9999-4999-8999-999999999999' }),
    );
    expect(await rejection(guard.canActivate(ctx(token())))).toBe(
      'SESSION_MISSING',
    );
  });

  it('refuses a revoked session (logout / password reset)', async () => {
    findUnique.mockResolvedValue(sessionRow({ revokedAt: new Date() }));
    expect(await rejection(guard.canActivate(ctx(token())))).toBe(
      'SESSION_REVOKED',
    );
  });

  it('refuses a session idle longer than SESSION_IDLE_MINUTES (default 120) and revokes it', async () => {
    findUnique.mockResolvedValue(
      sessionRow({ lastSeenAt: new Date(Date.now() - 121 * MINUTE) }),
    );
    expect(await rejection(guard.canActivate(ctx(token())))).toBe(
      'SESSION_IDLE',
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: sid, revokedAt: null },
      data: {
        revokedAt: expect.any(Date) as Date,
        revokedReason: 'IDLE',
      },
    });
  });

  it('honours a configured idle timeout', async () => {
    process.env.SESSION_IDLE_MINUTES = '30';
    findUnique.mockResolvedValue(
      sessionRow({ lastSeenAt: new Date(Date.now() - 31 * MINUTE) }),
    );
    expect(await rejection(guard.canActivate(ctx(token())))).toBe(
      'SESSION_IDLE',
    );
  });

  it('refuses a session past its absolute expiry', async () => {
    findUnique.mockResolvedValue(
      sessionRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    expect(await rejection(guard.canActivate(ctx(token())))).toBe(
      'SESSION_EXPIRED',
    );
  });

  it.each([
    ['inactive', { isActive: false, isLocked: false, deletedAt: null }],
    ['locked', { isActive: true, isLocked: true, deletedAt: null }],
    ['deleted', { isActive: true, isLocked: false, deletedAt: new Date() }],
  ])(
    'refuses an internal token of a %s user (live check)',
    async (_label, user) => {
      findUnique.mockResolvedValue(sessionRow({ user }));
      expect(await rejection(guard.canActivate(ctx(token())))).toBe(
        'ACCOUNT_UNAVAILABLE',
      );
    },
  );

  it('caches a session read for 15 s per process', async () => {
    const now = Date.now();
    await sessions.assertActive(sid, userId, now);
    await sessions.assertActive(sid, userId, now + SESSION_CACHE_TTL_MS - 1);
    expect(findUnique).toHaveBeenCalledTimes(1);
    await sessions.assertActive(sid, userId, now + SESSION_CACHE_TTL_MS);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('a revocation in this process takes effect immediately despite the cache', async () => {
    await expect(guard.canActivate(ctx(token()))).resolves.toBe(true);
    await sessions.revoke(sid, 'LOGOUT');
    findUnique.mockResolvedValue(sessionRow({ revokedAt: new Date() }));
    expect(await rejection(guard.canActivate(ctx(token())))).toBe(
      'SESSION_REVOKED',
    );
  });

  it('writes last_seen_at at most once a minute', async () => {
    const start = Date.now();
    findUnique.mockResolvedValue(sessionRow({ lastSeenAt: new Date(start) }));
    await sessions.assertActive(sid, userId, start + 1000);
    await sessions.assertActive(sid, userId, start + 30_000);
    expect(updateMany).not.toHaveBeenCalled();
    await sessions.assertActive(
      sid,
      userId,
      start + LAST_SEEN_WRITE_INTERVAL_MS,
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
    await sessions.assertActive(
      sid,
      userId,
      start + LAST_SEEN_WRITE_INTERVAL_MS + 10_000,
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
