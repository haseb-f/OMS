import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  AGENT_ACCESS_KEY,
  ALLOW_PENDING_PASSWORD_CHANGE_KEY,
} from '../decorators/agent-access.decorator';
import { PARTNER_ACCESS_KEY } from '../decorators/partner-access.decorator';
import type { PrismaService } from '../../prisma/prisma.service';
import type { UserSessionsService } from '../sessions/user-sessions.service';

/**
 * R15 (D15-14) — a company partner's login is a third audience: its token
 * reaches only `@PartnerPortal()` / `@PartnerShared()` handlers, the link to
 * its partner is re-verified live on every request, and the partner context
 * comes from the server, never from the request.
 */
describe('JwtAuthGuard — partner audience', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  const userId = '22222222-2222-4222-8222-222222222222';
  const profileId = '55555555-5555-4555-8555-555555555555';
  const partnerId = '66666666-6666-4666-8666-666666666666';

  let findFirst: jest.Mock;
  let guard: JwtAuthGuard;

  function ctx(
    token: string,
    meta: {
      partner?: 'partner-only' | 'shared';
      agent?: 'agent-only' | 'shared';
      allowPending?: boolean;
    } = {},
  ) {
    const handler = () => undefined;
    const clazz = class {};
    if (meta.partner)
      Reflect.defineMetadata(PARTNER_ACCESS_KEY, meta.partner, handler);
    if (meta.agent)
      Reflect.defineMetadata(AGENT_ACCESS_KEY, meta.agent, handler);
    if (meta.allowPending)
      Reflect.defineMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true, handler);
    const request = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as Request;
    const context = {
      getHandler: () => handler,
      getClass: () => clazz,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  const livePartnerUser = {
    id: userId,
    isActive: true,
    isLocked: false,
    userType: 'PARTNER',
    companyPartnerId: profileId,
    mustChangePassword: false,
    companyPartner: { id: profileId, partnerId },
  };

  beforeEach(() => {
    findFirst = jest.fn().mockResolvedValue(livePartnerUser);
    guard = new JwtAuthGuard(
      jwt,
      new Reflector(),
      { user: { findFirst } } as unknown as PrismaService,
      // Session liveness has its own spec (jwt-auth.guard.session.spec.ts).
      {
        assertActive: jest.fn().mockResolvedValue(undefined),
      } as unknown as UserSessionsService,
    );
  });

  const partnerToken = (claims: Record<string, unknown> = {}) =>
    jwt.sign({
      sub: userId,
      email: 'p@x.test',
      sid: 'sid-p',
      typ: 'partner',
      companyPartnerId: profileId,
      ...claims,
    });
  const internalToken = () =>
    jwt.sign({ sub: userId, email: 'i@x.test', sid: 'sid-i' });
  const agentToken = () =>
    jwt.sign({
      sub: userId,
      email: 'a@x.test',
      sid: 'sid-a',
      typ: 'agent',
      agentId: '11111111-1111-4111-8111-111111111111',
    });

  async function code(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    return ((error as ForbiddenException).getResponse() as { code?: string })
      .code;
  }

  it('rejects a partner token on any handler that did not opt in (internal endpoints)', async () => {
    const { context } = ctx(partnerToken());
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(await code(guard.canActivate(ctx(partnerToken()).context))).toBe(
      'PARTNER_ACCESS_DENIED',
    );
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects a partner token on agent handlers (agent-only and agent-shared)', async () => {
    for (const agent of ['agent-only', 'shared'] as const) {
      await expect(
        guard.canActivate(ctx(partnerToken(), { agent }).context),
      ).rejects.toThrow(ForbiddenException);
    }
  });

  it('admits a partner token on a partner-only handler and sets the verified partner context', async () => {
    const { context, request } = ctx(partnerToken(), {
      partner: 'partner-only',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.partnerContext).toEqual({
      userId,
      companyPartnerId: profileId,
      partnerId,
    });
    expect(request.agentContext).toBeUndefined();
  });

  it('admits a partner token on a shared handler (own profile, logout, password)', async () => {
    const { context } = ctx(partnerToken(), { partner: 'shared' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects internal and agent tokens on a partner-only handler', async () => {
    expect(
      await code(
        guard.canActivate(
          ctx(internalToken(), { partner: 'partner-only' }).context,
        ),
      ),
    ).toBe('PARTNER_ACCESS_DENIED');
    await expect(
      guard.canActivate(ctx(agentToken(), { partner: 'partner-only' }).context),
    ).rejects.toThrow(ForbiddenException);
  });

  it('keeps internal tokens on unmarked and partner-shared handlers', async () => {
    await expect(guard.canActivate(ctx(internalToken()).context)).resolves.toBe(
      true,
    );
    await expect(
      guard.canActivate(ctx(internalToken(), { partner: 'shared' }).context),
    ).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled login', { isActive: false }],
    ['locked login', { isLocked: true }],
    ['unlinked login', { companyPartnerId: null, companyPartner: null }],
    [
      're-linked login',
      {
        companyPartnerId: '77777777-7777-4777-8777-777777777777',
        companyPartner: {
          id: '77777777-7777-4777-8777-777777777777',
          partnerId: '88888888-8888-4888-8888-888888888888',
        },
      },
    ],
    ['internal user row', { userType: 'INTERNAL' }],
  ])(
    'rejects a still-valid partner token for a %s (401)',
    async (_l, patch) => {
      findFirst.mockResolvedValue({ ...livePartnerUser, ...patch });
      const { context } = ctx(partnerToken(), { partner: 'partner-only' });
      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    },
  );

  it('rejects a deleted login', async () => {
    findFirst.mockResolvedValue(null);
    const { context } = ctx(partnerToken(), { partner: 'partner-only' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('a temporary password opens only the change-password handlers', async () => {
    findFirst.mockResolvedValue({
      ...livePartnerUser,
      mustChangePassword: true,
    });
    expect(
      await code(
        guard.canActivate(
          ctx(partnerToken(), { partner: 'partner-only' }).context,
        ),
      ),
    ).toBe('MUST_CHANGE_PASSWORD');
    await expect(
      guard.canActivate(
        ctx(partnerToken(), { partner: 'shared', allowPending: true }).context,
      ),
    ).resolves.toBe(true);
  });
});
