import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import {
  PhoneNumberService,
  phoneErrorMessage,
} from '../common/phone/phone-number.service';
import {
  ALL_PERMISSION_NAMES,
  withImpliedSectionPermissions,
} from '../permissions/permission-catalog';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetUserPermissionsDto } from './dto/set-user-permissions.dto';

// Never select passwordHash into an API response.
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  username: true,
  fullName: true,
  mobile: true,
  department: true,
  isActive: true,
  isLocked: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  jobTitleId: true,
  jobTitle: { select: { id: true, name: true } },
  branchId: true,
  branch: { select: { id: true, name: true, code: true } },
} satisfies Prisma.UserSelect;

/**
 * TASK-060 — Users & Permissions. Every permission grant/revoke here goes
 * straight to `UserPermission` (never a Role) and always calls
 * `resolver.invalidate()` afterward, so the next request sees the change
 * immediately instead of waiting out the resolver's cache TTL.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionsResolverService,
    private readonly phoneNumberService: PhoneNumberService,
  ) {}

  /**
   * `User` has no `countryId` (unlike Lead/Customer/Supplier) — the
   * frontend's `OMSPhoneInput` always resolves a local number against the
   * user's chosen country to a full E.164 value before it ever reaches this
   * DTO, so this is a defense-in-depth check against a direct API call: it
   * accepts anything that parses as a genuine international number
   * (leading "+", or a recognizable "00..." prefix) and normalizes it, but
   * can't validate a bare local-format number with no country context at all.
   */
  private normalizeUserMobile(
    value: string | undefined | null,
  ): string | undefined {
    if (!value?.trim()) return undefined;
    const result = this.phoneNumberService.parse(value);
    if (!result.isValid || !result.e164) {
      throw new BadRequestException(phoneErrorMessage(result.errorReason));
    }
    return result.e164;
  }

  async create(dto: CreateUserDto) {
    const { password, mobile, ...rest } = dto;
    const passwordHash = await bcrypt.hash(password, 10);
    try {
      return await this.prisma.user.create({
        data: {
          ...rest,
          mobile: mobile ? this.normalizeUserMobile(mobile) : mobile,
          passwordHash,
        },
        select: PUBLIC_USER_SELECT,
      });
    } catch (error) {
      throw this.mapUniqueError(error);
    }
  }

  findAll(search?: string) {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.user.findMany({
      where,
      select: PUBLIC_USER_SELECT,
      orderBy: { fullName: 'asc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: PUBLIC_USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    const data = { ...dto };
    if (dto.mobile) {
      data.mobile = this.normalizeUserMobile(dto.mobile);
    }
    try {
      return await this.prisma.user.update({
        where: { id },
        data,
        select: PUBLIC_USER_SELECT,
      });
    } catch (error) {
      throw this.mapUniqueError(error);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    const removed = await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: PUBLIC_USER_SELECT,
    });
    this.resolver.invalidate(id);
    return removed;
  }

  /** "Lock" — a security action distinct from Active/Inactive; a locked user cannot log in even while Active. */
  async lock(id: string) {
    await this.findOne(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { isLocked: true },
      select: PUBLIC_USER_SELECT,
    });
    this.resolver.invalidate(id);
    return updated;
  }

  async unlock(id: string) {
    await this.findOne(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { isLocked: false },
      select: PUBLIC_USER_SELECT,
    });
    this.resolver.invalidate(id);
    return updated;
  }

  /** Admin sets a new password directly — always also flags "must change on next login" so the admin-chosen password is never the user's permanent one. */
  async resetPassword(id: string, dto: ResetPasswordDto) {
    await this.findOne(id);
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
      select: PUBLIC_USER_SELECT,
    });
  }

  /** "Force Password Change" — flags the account without touching the current password (distinct from Reset Password, which sets a new one). */
  async forcePasswordChange(id: string) {
    await this.findOne(id);
    return this.prisma.user.update({
      where: { id },
      data: { mustChangePassword: true },
      select: PUBLIC_USER_SELECT,
    });
  }

  /** The full grantable catalog alongside which names this user currently holds — exactly what the Permission Matrix needs to render checked/unchecked state. */
  async getPermissions(id: string) {
    await this.findOne(id);
    const rows = await this.prisma.userPermission.findMany({
      where: { userId: id },
      select: { permission: { select: { name: true } } },
    });
    return { granted: rows.map((row) => row.permission.name) };
  }

  /** Replaces the user's entire permission set (Part 3/11 — the matrix always saves the full checked list). Unknown/retired names are silently ignored rather than rejected, so a stale client payload can never 500. Implied coarse section permissions (see `withImpliedSectionPermissions`) are bundled in automatically, so a matrix grant never leaves its own sidebar section invisible. */
  async setPermissions(id: string, dto: SetUserPermissionsDto) {
    await this.findOne(id);
    const validNames = withImpliedSectionPermissions(
      dto.permissionNames.filter((name) => ALL_PERMISSION_NAMES.includes(name)),
    );
    const permissions = await this.prisma.permission.findMany({
      where: { name: { in: validNames } },
      select: { id: true },
    });

    await this.prisma.$transaction([
      this.prisma.userPermission.deleteMany({ where: { userId: id } }),
      this.prisma.userPermission.createMany({
        data: permissions.map((p) => ({ userId: id, permissionId: p.id })),
      }),
    ]);
    this.resolver.invalidate(id);
    return this.getPermissions(id);
  }

  /**
   * "Copy Permissions From" (Part 9) — user-to-user only, never a Role
   * template: replaces the target user's permission set with an exact copy
   * of the source user's current grants.
   */
  async copyPermissionsFrom(id: string, sourceUserId: string) {
    await this.findOne(id);
    if (id === sourceUserId) {
      throw new BadRequestException(
        'Cannot copy permissions from the same user.',
      );
    }
    await this.findOne(sourceUserId);
    const source = await this.getPermissions(sourceUserId);
    return this.setPermissions(id, { permissionNames: source.granted });
  }

  private mapUniqueError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const field =
        (error.meta?.target as string[] | undefined)?.[0] ?? 'field';
      return new BadRequestException(
        `A user with this ${field} already exists.`,
      );
    }
    return error;
  }
}
