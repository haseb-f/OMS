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
import {
  PARTNER_ACCESS_KEY,
  type PartnerAccessMode,
} from '../decorators/partner-access.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
  /** R14 — the server-side session (`user_sessions.id`) this token belongs to. */
  sid?: string;
  /** Present only on tokens issued to external agent users / company-partner logins. */
  typ?: 'agent' | 'partner';
  agentId?: string;
  /** R15 — `CompanyPartnerProfile.id` of a partner login (typ `partner`). */
  companyPartnerId?: string;
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

/**
 * R15 (D15-14) — server-verified link of a partner login, set on every
 * partner request. Portal handlers scope everything by `partnerId` from here,
 * never by a URL / query / body id.
 */
export interface PartnerRequestContext {
  userId: string;
  /** `CompanyPartnerProfile.id` (the user's `companyPartnerId`). */
  companyPartnerId: string;
  /** `Partner.id` — the key every company-partner document uses. */
  partnerId: string;
}

export const AGENT_ACCESS_DENIED = 'AGENT_ACCESS_DENIED';
export const PARTNER_ACCESS_DENIED = 'PARTNER_ACCESS_DENIED';

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
      this.assertPasswordChangeNotPending(context, verified.mustChangePassword);
      request.agentContext = verified.context;
      return true;
    }

    const partnerMode = this.reflector.getAllAndOverride<
      PartnerAccessMode | undefined
    >(PARTNER_ACCESS_KEY, [context.getHandler(), context.getClass()]);

    if (payload.typ === 'partner') {
      // R15 (D15-14) — same deny-by-default for a company partner's login:
      // only `@PartnerPortal()` / `@PartnerShared()` handlers, never an
      // internal or agent endpoint.
      if (!partnerMode) {
        throw new ForbiddenException({
          code: PARTNER_ACCESS_DENIED,
          message: 'This action is not available to partner users.',
        });
      }
      request.user = payload;
      const verified = await this.verifyPartnerUser(payload);
      this.assertPasswordChangeNotPending(context, verified.mustChangePassword);
      request.partnerContext = verified.context;
      return true;
    }

    if (partnerMode === 'partner-only') {
      throw new ForbiddenException({
        code: PARTNER_ACCESS_DENIED,
        message: 'This endpoint is only for partner users.',
      });
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
   * S7: a temporary password (new user, or reset by an administrator) is not
   * a working credential for an external login — until the user sets their
   * own, only profile, logout and change-password are reachable.
   */
  private assertPasswordChangeNotPending(
    context: ExecutionContext,
    mustChangePassword: boolean,
  ) {
    if (
      mustChangePassword &&
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

  /**
   * R15 — live link check on every partner request: a disabled, locked,
   * deleted or unlinked login (or one re-linked to another partner) loses
   * access at once. Profile status does not matter: after the partnership
   * ends the login keeps read-only access until an administrator disables
   * it (D15-14).
   */
  private async verifyPartnerUser(
    payload: JwtPayload,
  ): Promise<{ context: PartnerRequestContext; mustChangePassword: boolean }> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: {
        id: true,
        isActive: true,
        isLocked: true,
        userType: true,
        companyPartnerId: true,
        mustChangePassword: true,
        companyPartner: { select: { id: true, partnerId: true } },
      },
    });
    if (
      !user ||
      !user.isActive ||
      user.isLocked ||
      user.userType !== 'PARTNER' ||
      !user.companyPartnerId ||
      user.companyPartnerId !== payload.companyPartnerId ||
      !user.companyPartner
    ) {
      throw new UnauthorizedException({
        code: 'PARTNER_ACCOUNT_UNAVAILABLE',
        message: 'This partner login is disabled or no longer linked.',
      });
    }
    return {
      context: {
        userId: user.id,
        companyPartnerId: user.companyPartner.id,
        partnerId: user.companyPartner.partnerId,
      },
      mustChangePassword: user.mustChangePassword === true,
    };
  }
}
