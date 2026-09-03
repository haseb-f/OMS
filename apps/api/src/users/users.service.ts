import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { uniqueFieldFromPrismaError } from '../common/errors/prisma-unique-field';
import { PermissionsResolverService } from '../permissions/permissions-resolver.service';
import {
  PhoneNumberService,
  phoneErrorMessage,
} from '../common/phone/phone-number.service';
import {
  ALL_PERMISSION_NAMES,
  withImpliedSectionPermissions,
} from '../permissions/permission-catalog';
import {
  generateTemporaryPassword,
  hashPassword,
  normalizeEmail,
  normalizeUsername,
} from '../auth/password.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetUserPermissionsDto } from './dto/set-user-permissions.dto';
import { DepartmentsService } from '../departments/departments.service';

// Never select passwordHash into an API response.
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  username: true,
  fullName: true,
  mobile: true,
  departmentId: true,
  department: {
    select: {
      id: true,
      code: true,
      name: true,
      nameEn: true,
      isActive: true,
      deletedAt: true,
    },
  },
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

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof PUBLIC_USER_SELECT;
}>;

export type UserWithTemporaryPassword = PublicUser & {
  temporaryPassword: string;
};

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
    private readonly departments: DepartmentsService,
  ) {}

  /**
   * New assignment must be an active Department. Keeping the same archived
   * Department on an existing User is allowed (historical display).
   */
  private async assertDepartmentAssignment(
    nextId: string | undefined,
    currentId?: string | null,
  ) {
    if (!nextId) return;
    if (currentId && nextId === currentId) return;
    await this.departments.assertAssignable(nextId);
  }

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

  async create(
    dto: CreateUserDto,
  ): Promise<PublicUser | UserWithTemporaryPassword> {
    const { password, generatePassword, mobile, email, username } = dto;
    const shouldGenerate = generatePassword === true;
    const temporaryPassword = shouldGenerate
      ? generateTemporaryPassword()
      : undefined;
    const plainPassword = shouldGenerate ? temporaryPassword : password;
    if (!plainPassword || plainPassword.length < 8) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Password must be at least 8 characters.',
        fields: [{ field: 'password', constraints: ['minLength'] }],
      });
    }
    const passwordHash = await hashPassword(plainPassword);
    await this.assertDepartmentAssignment(dto.departmentId);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: normalizeEmail(email),
          username: normalizeUsername(username),
          fullName: dto.fullName,
          passwordHash,
          mobile: mobile ? this.normalizeUserMobile(mobile) : mobile,
          departmentId: dto.departmentId,
          jobTitleId: dto.jobTitleId,
          branchId: dto.branchId,
          isActive: dto.isActive,
          mustChangePassword: shouldGenerate,
        },
        select: PUBLIC_USER_SELECT,
      });
      return temporaryPassword ? { ...user, temporaryPassword } : user;
    } catch (error) {
      throw this.mapUniqueError(error);
    }
  }

  findAll(search?: string, departmentId?: string) {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (departmentId) {
      where.departmentId = departmentId;
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
    const existing = await this.findOne(id);
    await this.assertDepartmentAssignment(
      dto.departmentId,
      existing.departmentId,
    );
    const data: Prisma.UserUncheckedUpdateInput = { ...dto };
    if (dto.email !== undefined) {
      data.email = normalizeEmail(dto.email);
    }
    if (dto.username !== undefined) {
      data.username = normalizeUsername(dto.username);
    }
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

  /**
   * Admin reset — hashes server-side (never stores plaintext) and returns
   * the temporary password exactly once. JWT is stateless so existing tokens
   * cannot be revoked without a schema change; the new hash is used on the
   * next login.
   */
  async resetPassword(
    id: string,
    dto: ResetPasswordDto = {},
  ): Promise<UserWithTemporaryPassword> {
    await this.findOne(id);
    const temporaryPassword =
      dto.newPassword && dto.newPassword.length >= 8
        ? dto.newPassword
        : generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const user = await this.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
      select: PUBLIC_USER_SELECT,
    });
    return { ...user, temporaryPassword };
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

  /** Replaces the user's entire permission set (Part 3/11 — the matrix always saves the full checked list). Unknown/retired names are silently ignored rather than rejected, so a stale client payload can never 500. Implied coarse section permissions (see `withImpliedSectionPermissions`) are bundled in automatically. Missing `Permission` rows for those implied names are created rather than dropped, so a matrix grant never leaves its own sidebar section invisible. */
  async setPermissions(id: string, dto: SetUserPermissionsDto) {
    await this.findOne(id);
    const validNames = withImpliedSectionPermissions(
      dto.permissionNames.filter((name) => ALL_PERMISSION_NAMES.includes(name)),
    );
    const existing = await this.prisma.permission.findMany({
      where: { name: { in: validNames } },
      select: { id: true, name: true },
    });
    const existingNames = new Set(
      existing.map((permission) => permission.name),
    );
    const missingNames = validNames.filter((name) => !existingNames.has(name));
    if (missingNames.length > 0) {
      await this.prisma.permission.createMany({
        data: missingNames.map((name) => ({ name })),
        skipDuplicates: true,
      });
    }
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
      const field = uniqueFieldFromPrismaError(error.meta);
      return new BadRequestException({
        code: 'DUPLICATE',
        message: `A record with this ${field} already exists.`,
        fields: [{ field, constraints: ['unique'] }],
      });
    }
    return error;
  }
}
