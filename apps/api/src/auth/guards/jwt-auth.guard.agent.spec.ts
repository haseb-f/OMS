import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AGENT_ACCESS_KEY } from '../decorators/agent-access.decorator';
import type { PrismaService } from '../../prisma/prisma.service';
import type { UserSessionsService } from '../sessions/user-sessions.service';

/**
 * Agents milestone (specs/agents-fulfillment-partners §3) — shared login,
 * strictly separate affiliation: an agent token reaches only handlers that opt
 * in, and its affiliation is re-verified live on every request.
 */
describe('JwtAuthGuard — agent separation', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  const agentId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';

  let findFirst: jest.Mock;
  let guard: JwtAuthGuard;

  function ctx(token: string, mode?: 'agent-only' | 'shared') {
    const handler = () => undefined;
    const clazz = class {};
    if (mode) Reflect.defineMetadata(AGENT_ACCESS_KEY, mode, handler);
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

  const liveAgentUser = {
    id: userId,
    isActive: true,
    isLocked: false,
    userType: 'AGENT',
    agentId,
    agentRole: 'SALES',
    agent: { status: 'ACTIVE', deletedAt: null },
  };

  beforeEach(() => {
    findFirst = jest.fn().mockResolvedValue(liveAgentUser);
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

  const agentToken = () =>
    jwt.sign({
      sub: userId,
      email: 'a@x.test',
      sid: 'sid-a',
      typ: 'agent',
      agentId,
    });
  const internalToken = () =>
    jwt.sign({ sub: userId, email: 'i@x.test', sid: 'sid-i' });

  it('rejects an agent token on any handler that did not opt in (deny-by-default)', async () => {
    const { context } = ctx(agentToken());
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('admits an agent token on an agent-only handler and sets the verified agent context', async () => {
    const { context, request } = ctx(agentToken(), 'agent-only');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.agentContext).toEqual({
      userId,
      agentId,
      agentRole: 'SALES',
    });
  });

  it('admits an agent token on a shared handler', async () => {
    const { context } = ctx(agentToken(), 'shared');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects an internal token on an agent-only handler', async () => {
    const { context } = ctx(internalToken(), 'agent-only');
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('runs no agent affiliation query for internal tokens', async () => {
    const { context, request } = ctx(internalToken());
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.agentContext).toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['deactivated user', { isActive: false }],
    ['locked user', { isLocked: true }],
    ['re-affiliated user', { agentId: '33333333-3333-4333-8333-333333333333' }],
    ['internal user row', { userType: 'INTERNAL' }],
    ['inactive agent', { agent: { status: 'INACTIVE', deletedAt: null } }],
    ['archived agent', { agent: { status: 'ACTIVE', deletedAt: new Date() } }],
  ])('rejects a still-valid agent token for a %s', async (_label, patch) => {
    findFirst.mockResolvedValue({ ...liveAgentUser, ...patch });
    const { context } = ctx(agentToken(), 'agent-only');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a deleted user', async () => {
    findFirst.mockResolvedValue(null);
    const { context } = ctx(agentToken(), 'agent-only');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
