import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { InvestorPortalAccountStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from '../auth/password.util';
import { PortalLoginDto } from './dto/portal-login.dto';
import { PortalActivateDto } from './dto/portal-activate.dto';
import { PortalForgotPasswordDto } from './dto/portal-forgot-password.dto';
import { INVESTOR_PORTAL_JWT_SERVICE } from './investor-portal-jwt.provider';

const RESET_TOKEN_TTL_MINUTES = 30;

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Investor Engine Milestone 4, Part C — public (unauthenticated) Portal
 * auth flows. Mirrors `AuthService`'s hashed/single-use/expiring token
 * pattern exactly (never persists a raw token, always a generic
 * non-enumerating response), but every write/read here is scoped to
 * `InvestorPortalAccount`/`InvestorPortalActivationToken`, never `User`.
 */
@Injectable()
export class InvestorPortalAuthService {
  private readonly logger = new Logger(InvestorPortalAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(INVESTOR_PORTAL_JWT_SERVICE)
    private readonly portalJwt: JwtService,
  ) {}

  async login(dto: PortalLoginDto) {
    const email = normalizeEmail(dto.email);
    const account = await this.prisma.investorPortalAccount.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    const passwordMatches =
      !!account?.passwordHash &&
      (await verifyPassword(dto.password, account.passwordHash));
    if (!account || !passwordMatches) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }

    if (account.status !== InvestorPortalAccountStatus.ACTIVE) {
      // Deliberately still a generic 401 (mission Part 63 + no
      // user-enumeration) — INVITED/SUSPENDED/DISABLED never get a more
      // specific message that would confirm the account's existence/state
      // to an unauthenticated caller.
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }

    await this.prisma.investorPortalAccount.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = this.portalJwt.sign({
      portalAccountId: account.id,
      investorId: account.investorId,
      type: 'investor-portal' as const,
    });

    return { accessToken };
  }

  /**
   * Always returns a generic response, never reveals whether the email
   * exists (mirrors `AuthService.forgotPassword`). Conservative status
   * gating (documented here since it's a business-rule judgment call, not a
   * technical one): ACTIVE and SUSPENDED accounts may request a reset — a
   * suspended Investor should still be able to prove password ownership
   * without that unsuspending them (the token grants a new password, not
   * restored access; `activate()` never flips SUSPENDED back to ACTIVE).
   * INVITED accounts should re-request their invite (same activation flow,
   * different origin) rather than "forgot password" a password that was
   * never set — but since the response must not reveal status either way,
   * INVITED silently issues a fresh activation token too (harmless: it just
   * lets them set their initial password the same way). DISABLED must never
   * issue a token under any circumstance — a revoked account stays revoked.
   */
  async forgotPassword(dto: PortalForgotPasswordDto) {
    const email = normalizeEmail(dto.email);
    const account = await this.prisma.investorPortalAccount.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (account && account.status !== InvestorPortalAccountStatus.DISABLED) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      await this.prisma.investorPortalActivationToken.create({
        data: {
          portalAccountId: account.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
        },
      });
      // Local development only: no email transport is wired up yet. Never
      // log the raw token or the recipient address in a way that could
      // reach production logs.
      this.logger.log('Investor Portal password reset token created');
    }

    return {
      message:
        'If a Portal account exists for this email, a reset link has been sent.',
    };
  }

  /** Admin-triggered invite issues the same token type via `InvestorPortalAdminService`; this endpoint consumes it (first activation or a reset), identically. */
  async activate(dto: PortalActivateDto) {
    const tokenHash = hashToken(dto.token);
    const activationToken =
      await this.prisma.investorPortalActivationToken.findUnique({
        where: { tokenHash },
      });

    if (
      !activationToken ||
      activationToken.usedAt ||
      activationToken.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired activation token');
    }

    const account = await this.prisma.investorPortalAccount.findUnique({
      where: { id: activationToken.portalAccountId },
    });
    if (!account) {
      throw new BadRequestException('Invalid or expired activation token');
    }
    if (account.status === InvestorPortalAccountStatus.DISABLED) {
      throw new ForbiddenException('This Portal account has been disabled.');
    }

    const passwordHash = await hashPassword(dto.newPassword);
    // First-time activation (INVITED) turns the account ACTIVE. A password
    // reset for an already-SUSPENDED account changes the password only —
    // it must NOT silently lift a suspension an Admin deliberately put in
    // place (that requires the explicit Reactivate action).
    const nextStatus =
      account.status === InvestorPortalAccountStatus.INVITED
        ? InvestorPortalAccountStatus.ACTIVE
        : account.status;
    await this.prisma.$transaction([
      this.prisma.investorPortalAccount.update({
        where: { id: account.id },
        data: {
          passwordHash,
          status: nextStatus,
          activatedAt: account.activatedAt ?? new Date(),
        },
      }),
      this.prisma.investorPortalActivationToken.update({
        where: { id: activationToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { message: 'Your Portal account is ready. You can now log in.' };
  }
}
