import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { ResetPasswordDto } from '../users/dto/reset-password.dto';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import {
  CompanyPartnersService,
  IN_FORCE_STATUSES,
  PARTNER_LOGIN_SELECT,
  PROFILE_ENTITY,
  partnerLoginView,
} from './company-partners.service';
import type {
  CreatePartnerLoginDto,
  LinkPartnerLoginDto,
} from './dto/company-partners.dto';

/**
 * R15 (D15-14, spec-w4 §2) — a company partner's own login, administered
 * from the partner page under `company-partners.users.manage`. Creation goes
 * through `UsersService.createPartnerUser` (the only path that sets
 * `userType = PARTNER` / `companyPartnerId`), enable / disable through
 * `UsersService.update` and resets through `UsersService.resetPassword` —
 * the same flows agent users use. One login per partner; only once an
 * agreement is in force ("after configuring the agreement", 4.4). Every
 * change is on the partner's activity log.
 */
@Injectable()
export class PartnerLoginsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly partners: CompanyPartnersService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  /** The profile, refusing a second login and a login before any agreement is in force. */
  private async requireLoginTarget(partnerId: string) {
    const profile = await this.partners.requireProfile(partnerId);
    if (profile.user) {
      throw new ConflictException({
        code: 'PARTNER_LOGIN_EXISTS',
        message: `${profile.partner.name} already has a login (${profile.user.email}).`,
      });
    }
    const agreements = await this.prisma.partnerAgreement.count({
      where: { partnerId, status: { in: IN_FORCE_STATUSES } },
    });
    if (agreements === 0) {
      throw new ConflictException({
        code: 'PARTNER_LOGIN_NEEDS_AGREEMENT',
        message: `أضف اتفاقية سارية أولًا — Add an active profit-sharing agreement for ${profile.partner.name} before creating a login.`,
      });
    }
    return profile;
  }

  private async requireLogin(partnerId: string) {
    const profile = await this.partners.requireProfile(partnerId);
    if (!profile.user) {
      throw new NotFoundException({
        code: 'PARTNER_LOGIN_NOT_FOUND',
        message: `${profile.partner.name} has no login.`,
      });
    }
    return { profile, user: profile.user };
  }

  /** Creates the login with a generated temporary password (shown once, changed at first sign-in). */
  async create(partnerId: string, dto: CreatePartnerLoginDto, actorId: string) {
    const profile = await this.requireLoginTarget(partnerId);
    const created = await this.users.createPartnerUser({
      companyPartnerId: profile.id,
      email: dto.email,
      fullName: dto.fullName.trim(),
      createdBy: actorId,
    });
    await this.activityLog.log(
      PROFILE_ENTITY,
      partnerId,
      'LOGIN_CREATED',
      `Partner login created (${created.email})`,
      actorId,
      { userId: created.id },
    );
    return {
      login: partnerLoginView(await this.loginRow(created.id)),
      temporaryPassword: created.temporaryPassword,
    };
  }

  /** Partner logins not linked to any partner (picker of "Link existing login"). */
  candidates(search?: string) {
    const term = search?.trim();
    return this.prisma.user.findMany({
      where: {
        userType: 'PARTNER',
        companyPartnerId: null,
        deletedAt: null,
        ...(term && {
          OR: [
            { email: { contains: term, mode: 'insensitive' } },
            { fullName: { contains: term, mode: 'insensitive' } },
          ],
        }),
      },
      select: { id: true, email: true, fullName: true, isActive: true },
      orderBy: { fullName: 'asc' },
      take: 10,
    });
  }

  /** Links an existing, unlinked partner login; the unique link refuses a race. */
  async link(partnerId: string, dto: LinkPartnerLoginDto, actorId: string) {
    const profile = await this.requireLoginTarget(partnerId);
    const linked = await this.prisma.user.updateMany({
      where: {
        id: dto.userId,
        userType: 'PARTNER',
        companyPartnerId: null,
        deletedAt: null,
      },
      data: { companyPartnerId: profile.id, updatedBy: actorId },
    });
    if (linked.count === 0) {
      throw new ConflictException({
        code: 'PARTNER_LOGIN_NOT_LINKABLE',
        message:
          'Only a partner login that is not linked to another partner can be linked.',
      });
    }
    await this.activityLog.log(
      PROFILE_ENTITY,
      partnerId,
      'LOGIN_LINKED',
      'Existing partner login linked',
      actorId,
      { userId: dto.userId },
    );
    return partnerLoginView(await this.loginRow(dto.userId));
  }

  /** Detaches the login (it can no longer sign in) — it stays on record and can be linked again. */
  async unlink(partnerId: string, actorId: string) {
    const { user } = await this.requireLogin(partnerId);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { companyPartnerId: null, updatedBy: actorId },
    });
    await this.activityLog.log(
      PROFILE_ENTITY,
      partnerId,
      'LOGIN_UNLINKED',
      `Partner login unlinked (${user.email})`,
      actorId,
      { userId: user.id },
    );
    return { unlinked: true };
  }

  /** Disable / enable — a disabled login is refused at sign-in and on its next request. */
  async setActive(partnerId: string, isActive: boolean, actorId: string) {
    const { user } = await this.requireLogin(partnerId);
    await this.users.update(user.id, { isActive }, actorId);
    await this.activityLog.log(
      PROFILE_ENTITY,
      partnerId,
      isActive ? 'LOGIN_ENABLED' : 'LOGIN_DISABLED',
      `Partner login ${isActive ? 'enabled' : 'disabled'} (${user.email})`,
      actorId,
      { userId: user.id },
    );
    return partnerLoginView(await this.loginRow(user.id));
  }

  /** Administrator reset: every session ends; a generated password is returned once. */
  async resetPassword(
    partnerId: string,
    dto: ResetPasswordDto,
    actorId: string,
  ) {
    const { user } = await this.requireLogin(partnerId);
    const reset = await this.users.resetPassword(user.id, dto);
    await this.activityLog.log(
      PROFILE_ENTITY,
      partnerId,
      'LOGIN_PASSWORD_RESET',
      `Partner login password reset (${user.email})`,
      actorId,
      { userId: user.id },
    );
    return {
      login: partnerLoginView(await this.loginRow(user.id)),
      temporaryPassword:
        'temporaryPassword' in reset ? reset.temporaryPassword : undefined,
    };
  }

  private loginRow(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: PARTNER_LOGIN_SELECT,
    });
  }
}
