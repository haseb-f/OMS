import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { InvestorPortalAccountStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvitePortalAccountDto } from './dto/invite-portal-account.dto';

const ACTIVATION_TOKEN_TTL_MINUTES = 60 * 24 * 3; // 3 days

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function toStatusView(
  account: {
    email: string;
    status: InvestorPortalAccountStatus;
    invitedAt: Date | null;
    activatedAt: Date | null;
    lastLoginAt: Date | null;
  } | null,
) {
  if (!account) return { hasAccount: false as const };
  return {
    hasAccount: true as const,
    email: account.email,
    status: account.status,
    invitedAt: account.invitedAt,
    activatedAt: account.activatedAt,
    lastLoginAt: account.lastLoginAt,
  };
}

/**
 * Investor Engine Milestone 4, Part J/K — internal Admin management of an
 * Investor's Portal access (Invite/Suspend/Reactivate/Disable). Guarded by
 * `PermissionsGuard` (`investor-portal.*`), never the Portal's own guard —
 * this service is called by internal Users only.
 */
@Injectable()
export class InvestorPortalAdminService {
  private readonly logger = new Logger(InvestorPortalAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async findAccount(investorId: string) {
    return this.prisma.investorPortalAccount.findUnique({
      where: { investorId },
    });
  }

  async getStatus(investorId: string) {
    await this.assertInvestor(investorId);
    return toStatusView(await this.findAccount(investorId));
  }

  private async assertInvestor(investorId: string) {
    const investor = await this.prisma.investorProfile.findFirst({
      where: { id: investorId, deletedAt: null },
      include: { partner: { select: { email: true } } },
    });
    if (!investor) throw new NotFoundException('Investor not found.');
    return investor;
  }

  private async issueActivationToken(portalAccountId: string) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    await this.prisma.investorPortalActivationToken.create({
      data: {
        portalAccountId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + ACTIVATION_TOKEN_TTL_MINUTES * 60_000),
      },
    });
    // Local development only: no email transport is wired up yet. The raw
    // token is deliberately never returned in the API response — only
    // logged server-side so a developer can complete the flow locally.
    this.logger.log(
      `Investor Portal activation token issued for account ${portalAccountId} (dev-only, not emailed): ${rawToken}`,
    );
    return rawToken;
  }

  /** Idempotent: inviting an already-INVITED/ACTIVE/SUSPENDED account re-issues a token rather than erroring; only a brand-new row is created when none exists yet. */
  async invite(
    investorId: string,
    dto: InvitePortalAccountDto,
    userId?: string,
  ) {
    const investor = await this.assertInvestor(investorId);
    const email = dto.email ?? investor.partner.email;
    if (!email) {
      throw new BadRequestException(
        'This Investor has no email on file — provide one to invite them to the Portal.',
      );
    }

    let account = await this.findAccount(investorId);
    if (!account) {
      account = await this.prisma.investorPortalAccount.create({
        data: {
          investorId,
          email,
          status: InvestorPortalAccountStatus.INVITED,
          invitedAt: new Date(),
          invitedById: userId ?? null,
        },
      });
    } else if (account.status === InvestorPortalAccountStatus.DISABLED) {
      // Re-inviting a disabled account is the one deliberate way to bring
      // it back (see `disable()`'s doc comment) — a fresh INVITED cycle,
      // requiring a brand-new activation/password set, rather than a
      // one-click un-disable.
      account = await this.prisma.investorPortalAccount.update({
        where: { id: account.id },
        data: {
          email,
          status: InvestorPortalAccountStatus.INVITED,
          invitedAt: new Date(),
          invitedById: userId ?? null,
          passwordHash: null,
        },
      });
    } else {
      account = await this.prisma.investorPortalAccount.update({
        where: { id: account.id },
        data: { email, invitedAt: account.invitedAt ?? new Date() },
      });
    }

    await this.issueActivationToken(account.id);
    return toStatusView(account);
  }

  async resendInvite(investorId: string) {
    const account = await this.findAccount(investorId);
    if (!account) {
      throw new NotFoundException('This Investor has no Portal account yet.');
    }
    if (account.status === InvestorPortalAccountStatus.DISABLED) {
      throw new BadRequestException('This Portal account is disabled.');
    }
    await this.issueActivationToken(account.id);
    return toStatusView(account);
  }

  async suspend(investorId: string) {
    const account = await this.requireAccount(investorId);
    if (account.status !== InvestorPortalAccountStatus.ACTIVE) {
      throw new BadRequestException(
        'Only an active Portal account can be suspended.',
      );
    }
    const updated = await this.prisma.investorPortalAccount.update({
      where: { id: account.id },
      data: { status: InvestorPortalAccountStatus.SUSPENDED },
    });
    return toStatusView(updated);
  }

  async reactivate(investorId: string) {
    const account = await this.requireAccount(investorId);
    if (account.status !== InvestorPortalAccountStatus.SUSPENDED) {
      throw new BadRequestException(
        'Only a suspended Portal account can be reactivated.',
      );
    }
    const updated = await this.prisma.investorPortalAccount.update({
      where: { id: account.id },
      data: { status: InvestorPortalAccountStatus.ACTIVE },
    });
    return toStatusView(updated);
  }

  /** Terminal-ish: only re-activatable by re-inviting (which re-enables the account, mirroring how a brand-new invite works) — a deliberate extra step so "disable" reads as a real revocation, not a one-click toggle. */
  async disable(investorId: string) {
    const account = await this.requireAccount(investorId);
    if (account.status === InvestorPortalAccountStatus.DISABLED) {
      return toStatusView(account);
    }
    const updated = await this.prisma.investorPortalAccount.update({
      where: { id: account.id },
      data: { status: InvestorPortalAccountStatus.DISABLED },
    });
    return toStatusView(updated);
  }

  private async requireAccount(investorId: string) {
    const account = await this.findAccount(investorId);
    if (!account) {
      throw new NotFoundException('This Investor has no Portal account yet.');
    }
    return account;
  }
}
