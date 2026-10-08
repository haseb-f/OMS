import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MasterDataActivityLogService } from '../master-data/master-data-activity-log.service';
import { PermissionsResolverService } from './permissions-resolver.service';
import {
  ALL_PERMISSION_NAMES,
  isAgentPortalPermission,
  isPartnerPortalPermission,
} from './permission-catalog';
import {
  computeEffectivePermissions,
  permissionsGained,
} from './effective-permissions';

/** Audit vocabulary (spec-2 §A "Audit"). */
export const PERMISSION_AUDIT = {
  JOB_TITLE_PERMISSIONS: 'JOB_TITLE_PERMISSIONS',
  USER_PERMISSIONS: 'USER_PERMISSIONS',
  USER_JOB_TITLE: 'USER_JOB_TITLE',
} as const;

export interface UserPermissionPanel {
  userId: string;
  jobTitle: { id: string; name: string } | null;
  permissionsReviewRequired: boolean;
  /** The job title's template (what the user inherits before overrides). */
  inherited: string[];
  /** Individual GRANT rows. */
  grants: string[];
  /** Individual DENY rows. */
  denies: string[];
  /** The resolver's effective set (implications included). */
  effective: string[];
}

export interface TemplateImpactUser {
  userId: string;
  fullName: string;
  gained: string[];
  lost: string[];
  /** Template changes this user's individual overrides make ineffective. */
  ineffective: {
    permission: string;
    reason: 'DENIED_INDIVIDUALLY' | 'GRANTED_INDIVIDUALLY';
  }[];
}

export interface TemplateImpact {
  jobTitleId: string;
  added: string[];
  removed: string[];
  holderCount: number;
  users: TemplateImpactUser[];
}

interface StoredSources {
  template: string[];
  grants: string[];
  denies: string[];
}

const sorted = (names: Iterable<string>) => [...new Set(names)].sort();

/**
 * R14 W2 (spec-2 §A) — administration of job-title permission templates and
 * individual GRANT / DENY overrides. Never a second authorization engine:
 * every effective set it reasons about comes from `computeEffectivePermissions`,
 * the same formula `PermissionsResolverService` serves to the guards.
 *
 * Anti-escalation (server-enforced, 403 `PERMISSION_ESCALATION`): a non–super
 * admin cannot make anyone gain a permission they do not hold themselves —
 * through a template addition, an individual grant, or removing a DENY — and
 * cannot edit their own overrides.
 */
@Injectable()
export class PermissionAdministrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: PermissionsResolverService,
    private readonly activityLog: MasterDataActivityLogService,
  ) {}

  // ---------------------------------------------------------------- users

  async getUserPanel(userId: string): Promise<UserPermissionPanel> {
    const user = await this.findInternalUser(userId);
    const sources = await this.storedSources(userId, user.jobTitleId);
    return {
      userId,
      jobTitle: user.jobTitle,
      permissionsReviewRequired: user.permissionsReviewRequired,
      inherited: sources.template,
      grants: sources.grants,
      denies: sources.denies,
      effective: sorted(
        computeEffectivePermissions({ isAgentUser: false, ...sources }),
      ),
    };
  }

  /** Replaces the user's individual overrides (tri-state: absent = inherit). */
  async setUserOverrides(
    actorId: string,
    userId: string,
    input: { grants: string[]; denies: string[] },
  ): Promise<UserPermissionPanel> {
    const user = await this.findInternalUser(userId);
    const grants = this.assertGrantable(input.grants);
    const denies = this.assertGrantable(input.denies);
    const conflicting = grants.filter((name) => denies.includes(name));
    if (conflicting.length > 0) {
      throw new BadRequestException({
        code: 'PERMISSION_GRANT_DENY_CONFLICT',
        message: 'A permission cannot be granted and denied at the same time.',
        permissions: conflicting,
      });
    }
    const actorIsSuperAdmin = await this.resolver.isSuperAdmin(actorId);
    if (!actorIsSuperAdmin && actorId === userId) {
      throw new ForbiddenException({
        code: 'PERMISSION_ESCALATION',
        reason: 'SELF_EDIT',
        message:
          'لا يمكنك تعديل صلاحياتك الفردية — You cannot edit your own permission overrides.',
      });
    }

    const current = await this.storedSources(userId, user.jobTitleId);
    await this.assertNoEscalation(
      actorId,
      actorIsSuperAdmin,
      computeEffectivePermissions({ isAgentUser: false, ...current }),
      computeEffectivePermissions({
        isAgentUser: false,
        template: current.template,
        grants,
        denies,
      }),
    );

    const desired = new Map<string, 'GRANT' | 'DENY'>([
      ...grants.map((name) => [name, 'GRANT'] as const),
      ...denies.map((name) => [name, 'DENY'] as const),
    ]);
    const existing = new Map<string, 'GRANT' | 'DENY'>([
      ...current.grants.map((name) => [name, 'GRANT'] as const),
      ...current.denies.map((name) => [name, 'DENY'] as const),
    ]);
    const removed = [...existing.keys()].filter((name) => !desired.has(name));
    const changed = [...desired].filter(
      ([name, effect]) => existing.get(name) !== effect,
    );
    const permissionIds = await this.permissionIds([
      ...desired.keys(),
      ...removed,
    ]);

    await this.prisma.$transaction(async (tx) => {
      if (removed.length > 0) {
        await tx.userPermission.deleteMany({
          where: {
            userId,
            permissionId: {
              in: removed.map((name) => permissionIds.get(name)!),
            },
          },
        });
      }
      for (const [name, effect] of changed) {
        const permissionId = permissionIds.get(name)!;
        await tx.userPermission.upsert({
          where: { userId_permissionId: { userId, permissionId } },
          create: { userId, permissionId, effect, createdBy: actorId },
          update: { effect, createdBy: actorId, createdAt: new Date() },
        });
      }
      await tx.user.update({
        where: { id: userId },
        data: { permissionsReviewRequired: false, updatedBy: actorId },
      });
      if (removed.length > 0 || changed.length > 0) {
        await this.activityLog.log(
          'USER',
          userId,
          PERMISSION_AUDIT.USER_PERMISSIONS,
          `Permission overrides changed for ${user.fullName}`,
          actorId,
          {
            granted: sorted(
              changed.filter(([, e]) => e === 'GRANT').map(([n]) => n),
            ),
            denied: sorted(
              changed.filter(([, e]) => e === 'DENY').map(([n]) => n),
            ),
            removed: sorted(removed),
          },
          tx,
        );
      }
    });
    this.resolver.invalidate(userId);
    return this.getUserPanel(userId);
  }

  /**
   * Legacy full-list save (`POST /users/:id/permissions`, copy-from): the same
   * escalation rule, applied to the effective change it would cause.
   */
  async assertLegacyGrantAllowed(
    actorId: string,
    userId: string,
    nextGrants: string[],
  ) {
    const actorIsSuperAdmin = await this.resolver.isSuperAdmin(actorId);
    if (actorIsSuperAdmin) return;
    if (actorId === userId) {
      throw new ForbiddenException({
        code: 'PERMISSION_ESCALATION',
        reason: 'SELF_EDIT',
        message:
          'لا يمكنك تعديل صلاحياتك الفردية — You cannot edit your own permission overrides.',
      });
    }
    const user = await this.findInternalUser(userId);
    const current = await this.storedSources(userId, user.jobTitleId);
    const nextSet = new Set(nextGrants);
    await this.assertNoEscalation(
      actorId,
      false,
      computeEffectivePermissions({ isAgentUser: false, ...current }),
      computeEffectivePermissions({
        isAgentUser: false,
        template: current.template,
        grants: nextGrants,
        denies: current.denies.filter((name) => !nextSet.has(name)),
      }),
    );
  }

  /** Audit entry for the legacy full-list save (it was never audited). */
  logLegacyGrantSet(
    userId: string,
    before: string[],
    after: string[],
    actorId?: string,
  ) {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    const granted = sorted(after.filter((name) => !beforeSet.has(name)));
    const removed = sorted(before.filter((name) => !afterSet.has(name)));
    if (granted.length === 0 && removed.length === 0) return;
    return this.activityLog.log(
      'USER',
      userId,
      PERMISSION_AUDIT.USER_PERMISSIONS,
      'Permission grants replaced',
      actorId,
      { granted, denied: [], removed },
    );
  }

  /**
   * Job title changed on a user: the inherited template switches, individual
   * rows are kept, and the user is flagged for an administrator's review.
   */
  async recordJobTitleChange(
    userId: string,
    from: { id: string; name: string } | null,
    toId: string | null,
    actorId?: string,
  ) {
    const to = toId
      ? await this.prisma.jobTitle.findUnique({
          where: { id: toId },
          select: { id: true, name: true },
        })
      : null;
    await this.activityLog.log(
      'USER',
      userId,
      PERMISSION_AUDIT.USER_JOB_TITLE,
      `Job title changed: ${from?.name ?? '—'} → ${to?.name ?? '—'}`,
      actorId,
      {
        from: from ? { id: from.id, name: from.name } : null,
        to: to ? { id: to.id, name: to.name } : null,
      },
    );
    this.resolver.invalidate(userId);
  }

  // ------------------------------------------------------------ templates

  async getTemplate(jobTitleId: string) {
    const jobTitle = await this.findJobTitle(jobTitleId);
    const [permissions, holderCount] = await Promise.all([
      this.templateNames(jobTitleId),
      this.prisma.user.count({
        where: { jobTitleId, userType: 'INTERNAL', deletedAt: null },
      }),
    ]);
    return { jobTitle, permissions, holderCount };
  }

  async previewTemplate(
    jobTitleId: string,
    names: string[],
  ): Promise<TemplateImpact> {
    await this.findJobTitle(jobTitleId);
    const next = this.assertGrantable(names);
    const current = await this.templateNames(jobTitleId);
    return this.impactOf(jobTitleId, current, next);
  }

  async setTemplate(actorId: string, jobTitleId: string, names: string[]) {
    const jobTitle = await this.findJobTitle(jobTitleId);
    const next = this.assertGrantable(names);
    const current = await this.templateNames(jobTitleId);
    const actorIsSuperAdmin = await this.resolver.isSuperAdmin(actorId);
    await this.assertNoEscalation(
      actorId,
      actorIsSuperAdmin,
      computeEffectivePermissions({
        isAgentUser: false,
        template: current,
        grants: [],
        denies: [],
      }),
      computeEffectivePermissions({
        isAgentUser: false,
        template: next,
        grants: [],
        denies: [],
      }),
    );
    const impact = await this.impactOf(jobTitleId, current, next);
    const permissionIds = await this.permissionIds([...next, ...current]);

    await this.prisma.$transaction(async (tx) => {
      if (impact.removed.length > 0) {
        await tx.jobTitlePermission.deleteMany({
          where: {
            jobTitleId,
            permissionId: {
              in: impact.removed.map((name) => permissionIds.get(name)!),
            },
          },
        });
      }
      if (impact.added.length > 0) {
        await tx.jobTitlePermission.createMany({
          data: impact.added.map((name) => ({
            jobTitleId,
            permissionId: permissionIds.get(name)!,
            createdBy: actorId,
          })),
          skipDuplicates: true,
        });
      }
      if (impact.added.length > 0 || impact.removed.length > 0) {
        await this.activityLog.log(
          'JOB_TITLE',
          jobTitleId,
          PERMISSION_AUDIT.JOB_TITLE_PERMISSIONS,
          `Default permissions changed for ${jobTitle.name}`,
          actorId,
          {
            added: impact.added,
            removed: impact.removed,
            affectedUsers: impact.users.filter(
              (u) => u.gained.length > 0 || u.lost.length > 0,
            ).length,
          },
          tx,
        );
      }
    });
    // Applies live: every holder's cached set is dropped in this instance.
    const holders = await this.prisma.user.findMany({
      where: { jobTitleId },
      select: { id: true },
    });
    this.resolver.invalidateMany(holders.map((holder) => holder.id));
    return { ...(await this.getTemplate(jobTitleId)), impact };
  }

  // -------------------------------------------------------------- helpers

  private async impactOf(
    jobTitleId: string,
    current: string[],
    next: string[],
  ): Promise<TemplateImpact> {
    const currentSet = new Set(current);
    const nextSet = new Set(next);
    const added = sorted(next.filter((name) => !currentSet.has(name)));
    const removed = sorted(current.filter((name) => !nextSet.has(name)));
    const holders = await this.prisma.user.findMany({
      where: { jobTitleId, userType: 'INTERNAL', deletedAt: null },
      select: {
        id: true,
        fullName: true,
        userPermissions: {
          select: { effect: true, permission: { select: { name: true } } },
        },
      },
      orderBy: { fullName: 'asc' },
    });
    const users = holders.map((holder): TemplateImpactUser => {
      const grants = holder.userPermissions
        .filter((row) => row.effect === 'GRANT')
        .map((row) => row.permission.name);
      const denies = holder.userPermissions
        .filter((row) => row.effect === 'DENY')
        .map((row) => row.permission.name);
      const before = computeEffectivePermissions({
        isAgentUser: false,
        template: current,
        grants,
        denies,
      });
      const after = computeEffectivePermissions({
        isAgentUser: false,
        template: next,
        grants,
        denies,
      });
      const ineffective: TemplateImpactUser['ineffective'] = [
        ...added
          .filter((name) => denies.includes(name))
          .map((permission) => ({
            permission,
            reason: 'DENIED_INDIVIDUALLY' as const,
          })),
        ...removed
          .filter((name) => grants.includes(name))
          .map((permission) => ({
            permission,
            reason: 'GRANTED_INDIVIDUALLY' as const,
          })),
      ];
      return {
        userId: holder.id,
        fullName: holder.fullName,
        gained: permissionsGained(before, after),
        lost: permissionsGained(after, before),
        ineffective,
      };
    });
    return { jobTitleId, added, removed, holderCount: holders.length, users };
  }

  private async assertNoEscalation(
    actorId: string,
    actorIsSuperAdmin: boolean,
    before: ReadonlySet<string>,
    after: ReadonlySet<string>,
  ) {
    if (actorIsSuperAdmin) return;
    const held = await this.resolver.getPermissions(actorId);
    const notHeld = permissionsGained(before, after).filter(
      (name) => !held.has(name),
    );
    if (notHeld.length > 0) {
      throw new ForbiddenException({
        code: 'PERMISSION_ESCALATION',
        reason: 'NOT_HELD',
        message:
          'لا يمكنك منح صلاحيات لا تملكها — You cannot grant permissions you do not hold yourself.',
        permissions: notHeld,
      });
    }
  }

  /** Known, INTERNAL catalog permissions only — never an `agent.*` or `partner.*` key. */
  private assertGrantable(names: string[]): string[] {
    const unique = sorted(names);
    const invalid = unique.filter(
      (name) =>
        !ALL_PERMISSION_NAMES.includes(name) ||
        isAgentPortalPermission(name) ||
        isPartnerPortalPermission(name),
    );
    if (invalid.length > 0) {
      throw new BadRequestException({
        code: 'UNKNOWN_PERMISSION',
        message:
          'Only internal catalog permissions can be granted, denied or added to a template.',
        permissions: invalid,
      });
    }
    return unique;
  }

  /** Permission ids by name, creating catalog rows that are still missing. */
  private async permissionIds(names: string[]): Promise<Map<string, string>> {
    const unique = sorted(names);
    if (unique.length === 0) return new Map();
    await this.prisma.permission.createMany({
      data: unique.map((name) => ({ name })),
      skipDuplicates: true,
    });
    const rows = await this.prisma.permission.findMany({
      where: { name: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.name, row.id]));
  }

  private async storedSources(
    userId: string,
    jobTitleId: string | null,
  ): Promise<StoredSources> {
    const [rows, template] = await Promise.all([
      this.prisma.userPermission.findMany({
        where: { userId },
        select: { effect: true, permission: { select: { name: true } } },
      }),
      jobTitleId ? this.templateNames(jobTitleId) : Promise.resolve([]),
    ]);
    return {
      template,
      grants: sorted(
        rows.filter((r) => r.effect === 'GRANT').map((r) => r.permission.name),
      ),
      denies: sorted(
        rows.filter((r) => r.effect === 'DENY').map((r) => r.permission.name),
      ),
    };
  }

  private async templateNames(jobTitleId: string): Promise<string[]> {
    const rows = await this.prisma.jobTitlePermission.findMany({
      where: { jobTitleId },
      select: { permission: { select: { name: true } } },
    });
    return sorted(rows.map((row) => row.permission.name));
  }

  private async findInternalUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        userType: true,
        jobTitleId: true,
        jobTitle: { select: { id: true, name: true } },
        permissionsReviewRequired: true,
      },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    if (user.userType !== 'INTERNAL') {
      throw new BadRequestException({
        code: 'AGENT_USER_MANAGED_IN_AGENTS',
        message:
          'مستخدمو الوكلاء يُدارون من صفحة الوكيل — Agent users keep their agent role presets.',
      });
    }
    return user;
  }

  private async findJobTitle(jobTitleId: string) {
    const jobTitle = await this.prisma.jobTitle.findFirst({
      where: { id: jobTitleId },
      select: { id: true, code: true, name: true, nameEn: true },
    });
    if (!jobTitle) {
      throw new NotFoundException(`Job title ${jobTitleId} not found`);
    }
    return jobTitle;
  }
}
