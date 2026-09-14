import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { InvestorPortalAccountStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  INVESTOR_PORTAL_JWT_SERVICE,
  InvestorPortalJwtPayload,
} from './investor-portal-jwt.provider';

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

/**
 * Investor Engine Milestone 4, Part C — the entire Investor Portal external
 * access boundary lives in this one guard. Deliberately does NOT inject the
 * internal `JwtService` (mission Part 18/22/52): it verifies exclusively
 * with the dedicated `INVESTOR_PORTAL_JWT_SERVICE` instance, so an internal
 * session token can never pass here and a Portal token can never pass the
 * internal `JwtAuthGuard`.
 *
 * Also re-checks the account's LIVE status on every request (mission Part
 * 63 "disabled account test") — a still-unexpired JWT for an account that
 * gets SUSPENDED/DISABLED after issuance must stop working on the very next
 * request, not just at token expiry.
 */
@Injectable()
export class InvestorPortalAuthGuard implements CanActivate {
  constructor(
    @Inject(INVESTOR_PORTAL_JWT_SERVICE)
    private readonly portalJwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: InvestorPortalJwtPayload;
    try {
      payload = this.portalJwt.verify<InvestorPortalJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (payload.type !== 'investor-portal' || !payload.portalAccountId) {
      // Structurally not a Portal token — defense in depth on top of the
      // secret already being different from the internal one.
      throw new UnauthorizedException('Invalid token');
    }

    const account = await this.prisma.investorPortalAccount.findUnique({
      where: { id: payload.portalAccountId },
      select: { id: true, investorId: true, status: true },
    });
    if (
      !account ||
      account.status !== InvestorPortalAccountStatus.ACTIVE ||
      account.investorId !== payload.investorId
    ) {
      throw new UnauthorizedException('Account is no longer active');
    }

    request.portalInvestor = {
      portalAccountId: account.id,
      investorId: account.investorId,
      type: 'investor-portal',
    };
    return true;
  }
}
