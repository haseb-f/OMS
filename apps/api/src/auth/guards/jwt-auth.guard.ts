import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { UserSessionsService } from '../sessions/user-sessions.service';
import {
  AGENT_ACCESS_KEY,
  ALLOW_PENDING_PASSWORD_CHANGE_KEY,
  type AgentAccessMode,
} from '../decorators/agent-access.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
  /** R14 — the server-side session (`user_sessions.id`) this token belongs to. */
  sid?: string;
  /** Present only on tokens issued to external agent users. */
  typ?: 'agent';
  agentId?: string;
}

/** Server-verified affiliation of an agent user, set on every agent request. */
export interface AgentRequestContext {
  userId: string;
  agentId: string;
  agentRole: 'ADMIN' | 'SALES';
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

export const AGENT_ACCESS_DENIED = 'AGENT_ACCESS_DENIED';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly sessions: UserSessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // R14 — every token (internal and agent) is bound to a live server-side
    // session: logout / password reset / idle timeout end it immediately, and
    // a deleted, inactive or locked user is refused on the next request.
    await this.sessions.assertActive(payload.sid, payload.sub);

    const mode = this.reflector.getAllAndOverride<AgentAccessMode | undefined>(
      AGENT_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (payload.typ === 'agent') {
      // Deny-by-default: an external agent user reaches only handlers that
      // explicitly opt in — never an internal list, action, import, export
      // or picker, whatever permission rows might exist.
      if (!mode) {
        throw new ForbiddenException({
          code: AGENT_ACCESS_DENIED,
          message: 'This action is not available to agent users.',
        });
      }
      request.user = payload;
      const verified = await this.verifyAgentUser(payload);
      // S7: a temporary password (new user or reset by an Agent Admin /
      // the company) is not a working credential — until the user sets
      // their own, only profile, logout and change-password are reachable.
      if (
        verified.mustChangePassword &&
        !this.reflector.getAllAndOverride<boolean | undefined>(
          ALLOW_PENDING_PASSWORD_CHANGE_KEY,
          [context.getHandler(), context.getClass()],
        )
      ) {
        throw new ForbiddenException({
          code: 'MUST_CHANGE_PASSWORD',
          message:
            'غيّر كلمة المرور المؤقتة أولًا — Change your temporary password before continuing.',
        });
      }
      request.agentContext = verified.context;
      return true;
    }

    if (mode === 'agent-only') {
      throw new ForbiddenException({
        code: AGENT_ACCESS_DENIED,
        message: 'This endpoint is only for agent users.',
      });
    }
    request.user = payload;
    return true;
  }

  /**
   * Live affiliation check on every agent request: a deactivated, locked or
   * re-affiliated user, or an inactive agent, loses access immediately
   * (internal users get the user-level part through the session check).
   */
  private async verifyAgentUser(
    payload: JwtPayload,
  ): Promise<{ context: AgentRequestContext; mustChangePassword: boolean }> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: {
        id: true,
        isActive: true,
        isLocked: true,
        userType: true,
        agentId: true,
        agentRole: true,
        mustChangePassword: true,
        agent: { select: { status: true, deletedAt: true } },
      },
    });
    if (
      !user ||
      !user.isActive ||
      user.isLocked ||
      user.userType !== 'AGENT' ||
      !user.agentId ||
      !user.agentRole ||
      user.agentId !== payload.agentId ||
      !user.agent ||
      user.agent.deletedAt ||
      user.agent.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException({
        code: 'AGENT_ACCOUNT_UNAVAILABLE',
        message: 'This agent account is inactive or no longer available.',
      });
    }
    return {
      context: {
        userId: user.id,
        agentId: user.agentId,
        agentRole: user.agentRole,
      },
      mustChangePassword: user.mustChangePassword === true,
    };
  }
}
