import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const RESET_TOKEN_TTL_MINUTES = 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly permissionsResolver: PermissionsResolverService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.isLocked) {
      throw new UnauthorizedException(
        'This account is locked. Contact an administrator.',
      );
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const expiresIn = dto.rememberMe ? '30d' : undefined;
    const accessToken = this.jwtService.sign(
      { sub: user.id, email: user.email },
      expiresIn ? { expiresIn } : undefined,
    );

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  /** Always returns a generic response — never reveals whether the email exists. */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null, isActive: true },
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

      const resetUrl = `${process.env.WEB_APP_URL ?? 'http://localhost:3001'}/reset-password?token=${rawToken}`;
      // Local development only: no email transport is wired up yet, so the
      // reset link is logged instead of sent. A future notifications module
      // replaces this line with a real email send.

      console.log(`[auth] Password reset link for ${email}: ${resetUrl}`);
    }

    return {
      message:
        'If an account exists for this email, a reset link has been sent.',
    };
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

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { message: 'Password has been reset successfully.' };
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        jobTitle: { select: { id: true, name: true } },
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
      permissions,
      companies,
    };
  }
}
