import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { hashPassword, normalizeEmail, verifyPassword } from './password.util';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import { UserSessionsService } from './sessions/user-sessions.service';

const RESET_TOKEN_TTL_MINUTES = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsResolver: PermissionsResolverService,
    private readonly sessions: UserSessionsService,
  ) {}

  /**
   * R14 — every login opens a server-side session whose id travels in the
   * token as `sid`; its absolute end is the token's own `exp`
   * (`SESSION_ABSOLUTE_HOURS`, default 12). `dto.rememberMe` is accepted from older clients but
   * ignored: the lifetime is never extended.
   */
  async login(dto: LoginDto, userAgent?: string | null) {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        email: { equals: email, mode: 'insensitive' },
      },
      include: { agent: { select: { status: true, deletedAt: true } } },
    });

    const passwordMatches =
      !!user && (await verifyPassword(dto.password, user.passwordHash));
    if (!user || !passwordMatches) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
    }

    if (!user.isActive) {
      throw new ForbiddenException({
        code: 'ACCOUNT_DISABLED',
        message: 'This account is inactive.',
      });
    }
    if (user.isLocked) {
      throw new ForbiddenException({
        code: 'ACCOUNT_LOCKED',
        message: 'This account is locked.',
      });
    }

    // External agent users share the login but carry an explicit agent
    // claim; the guard confines such tokens to agent-portal handlers.
    const isAgentUser = user.userType === 'AGENT';
    if (
      isAgentUser &&
      (!user.agentId ||
        !user.agent ||
        user.agent.deletedAt ||
        user.agent.status !== 'ACTIVE')
    ) {
      throw new ForbiddenException({
        code: 'AGENT_INACTIVE',
        message: 'This agent account is inactive.',
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = await this.sessions.issueAccessToken(
      isAgentUser
        ? {
            sub: user.id,
            email: user.email,
            typ: 'agent',
            agentId: user.agentId,
          }
        : { sub: user.id, email: user.email },
      userAgent,
    );

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        mustChangePassword: user.mustChangePassword,
        userType: user.userType,
      },
    };
  }

  /** Ends the caller's own session server-side (the token stops working at once). */
  async logout(sessionId: string | undefined) {
    if (sessionId) await this.sessions.revoke(sessionId, 'LOGOUT');
    return { message: 'Logged out.' };
  }

  /** Always returns a generic response — never reveals whether the email exists. */
  async forgotPassword(email: string) {
    const normalized = normalizeEmail(email);
    const user = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        email: { equals: normalized, mode: 'insensitive' },
      },
    });

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto
        .createHash('sha256')
        .update(rawToken)
        .digest('hex');

      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
        },
      });

      // Local development only: no email transport is wired up yet. Do not
      // log the raw token or the recipient address.
      this.logger.log('Password reset token created');
    }

    return {
      message:
        'If an account exists for this email, a reset link has been sent.',
    };
  }

  /**
   * Self-service change (S7): the current password must match and the new
   * one must differ. Clears `mustChangePassword`, which is what unblocks an
   * agent user after a temporary password was issued.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    currentSessionId?: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, passwordHash: true },
    });
    if (
      !user ||
      !(await verifyPassword(dto.currentPassword, user.passwordHash))
    ) {
      throw new BadRequestException({
        code: 'CURRENT_PASSWORD_INVALID',
        message:
          'كلمة المرور الحالية غير صحيحة — The current password is incorrect.',
      });
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException({
        code: 'PASSWORD_UNCHANGED',
        message:
          'كلمة المرور الجديدة يجب أن تختلف عن الحالية — The new password must differ from the current one.',
      });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(dto.newPassword),
        mustChangePassword: false,
      },
    });
    // Every other sign-in of this user ends; the session that changed it stays.
    await this.sessions.revokeAllForUser(
      user.id,
      'PASSWORD_CHANGED',
      currentSessionId,
    );
    return { message: 'Password changed.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = crypto
      .createHash('sha256')
      .update(dto.token)
      .digest('hex');

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash, mustChangePassword: false },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);
    await this.sessions.revokeAllForUser(resetToken.userId, 'PASSWORD_RESET');

    return { message: 'Password has been reset successfully.' };
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        jobTitle: { select: { id: true, name: true } },
        agent: {
          select: {
            id: true,
            agentNumber: true,
            name: true,
            status: true,
            deletedAt: true,
          },
        },
        companyMemberships: {
          include: {
            company: { include: { branches: { where: { deletedAt: null } } } },
            branch: true,
          },
        },
      },
    });

    if (!user || !user.isActive || user.isLocked) {
      throw new UnauthorizedException('User not found, inactive, or locked');
    }

    const permissions = [
      ...(await this.permissionsResolver.getPermissions(user.id)),
    ];
    const companies = user.companyMemberships.map((membership) => ({
      id: membership.company.id,
      name: membership.company.name,
      code: membership.company.code,
      logoUrl: membership.company.logoUrl,
      primaryColor: membership.company.primaryColor,
      secondaryColor: membership.company.secondaryColor,
      branches: membership.company.branches.map((branch) => ({
        id: branch.id,
        name: branch.name,
        code: branch.code,
      })),
      defaultBranchId: membership.branch?.id ?? null,
    }));

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      jobTitle: user.jobTitle?.name ?? null,
      mustChangePassword: user.mustChangePassword,
      /// TASK-060 — "roles" no longer exists as an access-control concept (Odoo-style RBAC is forbidden); kept as an empty array only so any not-yet-updated frontend reads of `user.roles` degrade to "no roles" instead of crashing.
      roles: [] as string[],
      isSuperAdmin: user.isSuperAdmin,
      permissions,
      companies,
      /** INTERNAL (company staff) or AGENT (external agent user). */
      userType: user.userType,
      agentRole: user.agentRole,
      agent:
        user.userType === 'AGENT' && user.agent
          ? {
              id: user.agent.id,
              agentNumber: user.agent.agentNumber,
              name: user.agent.name,
            }
          : null,
    };
  }
}
