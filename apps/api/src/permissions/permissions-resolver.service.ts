import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeEffectivePermissions } from './effective-permissions';

interface CacheEntry {
  isSuperAdmin: boolean;
  isAgentUser: boolean;
  /** Explicit grants + authorization-bearing implications only (SEC-03 H4). */
  permissions: Set<string>;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

/**
 * TASK-060 Part 12 — "Single permission resolver. Permission cache. Reuse
 * middleware. No duplicated checks." The ONE place that reads a user's
 * effective permissions (direct `UserPermission` grants, never a Role
 * chain) — both `AuthService.getCurrentUser()` (drives the frontend's
 * `hasPermission()`) and `PermissionsGuard` (backend enforcement) call this
 * same service, so the two can never disagree. A short in-memory TTL cache
 * avoids a query per request; `invalidate()` is called by every mutation
 * that can change what a user is allowed to do (grant/revoke permissions,
 * lock/unlock).
 *
 * SYSTEM_ADMIN bypass — `User.isSuperAdmin` is resolved alongside the
 * grant list and short-circuits `hasPermission()` to always `true`. This
 * covers every caller of `hasPermission()` (the guard, and the couple of
 * ad-hoc business checks like "can view all leads") from one place.
 * `getPermissions()` returns the AUTHORIZATION set: the user's stored grants
 * plus only the implications that may authorize data access (coarse section
 * keys that are not catalog permissions, and same-module implications —
 * see `withAuthorizationImpliedPermissions`). A cross-module implication onto
 * a real data permission (Customer Groups → `partners.view`) is dropped, so
 * a sidebar convenience can never unlock an API (SEC-03 H4). `/auth/me`
 * serves this same set, so the web's nav filter, route guard and page gates
 * agree with the guards; nav items under those sections are gated on their
 * page's own module key, and section parents appear via any authorized
 * descendant (`filterByAccess`).
 */
@Injectable()
export class PermissionsResolverService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  private async load(userId: string): Promise<CacheEntry> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const [user, rows] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          isSuperAdmin: true,
          userType: true,
          agentRole: true,
          jobTitleId: true,
        },
      }),
      this.prisma.userPermission.findMany({
        where: { userId },
        select: { effect: true, permission: { select: { name: true } } },
      }),
    ]);
    // Agents milestone (spec §3): shared login never means shared
    // privileges. An agent user's effective set is only its `agent.*` rows —
    // any internal row (e.g. a same-named role grant) is ignored — and an
    // internal user never holds `agent.*`. Agent users are never super admins.
    const isAgentUser = user?.userType === 'AGENT';
    // R14 (spec-2 §A) — INTERNAL users inherit their job title's template;
    // individual rows are GRANT (default) or DENY overrides.
    const template =
      !isAgentUser && user?.jobTitleId
        ? await this.prisma.jobTitlePermission.findMany({
            where: { jobTitleId: user.jobTitleId },
            select: { permission: { select: { name: true } } },
          })
        : [];
    const permissions = computeEffectivePermissions({
      isAgentUser,
      agentRole: user?.agentRole,
      template: template.map((row) => row.permission.name),
      grants: rows
        .filter((row) => row.effect !== 'DENY')
        .map((row) => row.permission.name),
      denies: rows
        .filter((row) => row.effect === 'DENY')
        .map((row) => row.permission.name),
    });
    const entry: CacheEntry = {
      isSuperAdmin: !isAgentUser && (user?.isSuperAdmin ?? false),
      isAgentUser,
      permissions,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    this.cache.set(userId, entry);
    return entry;
  }

  async getPermissions(userId: string): Promise<Set<string>> {
    return (await this.load(userId)).permissions;
  }

  async isSuperAdmin(userId: string): Promise<boolean> {
    return (await this.load(userId)).isSuperAdmin;
  }

  async hasPermission(
    userId: string,
    permissionName: string,
  ): Promise<boolean> {
    const entry = await this.load(userId);
    return entry.isSuperAdmin || entry.permissions.has(permissionName);
  }

  async isAgentUser(userId: string): Promise<boolean> {
    return (await this.load(userId)).isAgentUser;
  }

  /**
   * Drops this process's cached entry. Other API instances keep theirs until
   * the 60 s TTL expires — cross-instance staleness is bounded by CACHE_TTL_MS
   * (spec-2 §A "Cache").
   */
  invalidate(userId: string) {
    this.cache.delete(userId);
  }

  /** R14 — a job-title template change invalidates every holder of the title. */
  invalidateMany(userIds: Iterable<string>) {
    for (const userId of userIds) this.cache.delete(userId);
  }

  /**
   * TASK-061 — the reverse lookup Auto Assignment needs ("which users may
   * receive this kind of work?"). Reads `UserPermission` directly rather
   * than iterating every user through `hasPermission()`, but stays the same
   * "one resolver" source of truth — no parallel permission-matching logic
   * anywhere else.
   */
  async getUsersWithPermission(
    permissionName: string,
    /** Restrict the lookup to these users (e.g. one candidate). */
    amongUserIds?: string[],
  ): Promise<string[]> {
    const among = amongUserIds ? { id: { in: amongUserIds } } : {};
    // Internal work pools (lead round robin, assignment pickers) never
    // include external agent users (spec §3). R14 — a holder is an INTERNAL
    // user with an individual GRANT or a job-title template carrying the
    // permission, and without an individual DENY on it.
    const [granted, inherited, denied] = await Promise.all([
      this.prisma.userPermission.findMany({
        where: {
          effect: 'GRANT',
          permission: { name: permissionName },
          user: { userType: 'INTERNAL', ...among },
        },
        select: { userId: true },
      }),
      this.prisma.user.findMany({
        where: {
          userType: 'INTERNAL',
          ...among,
          jobTitle: {
            permissionTemplate: {
              some: { permission: { name: permissionName } },
            },
          },
        },
        select: { id: true },
      }),
      this.prisma.userPermission.findMany({
        where: {
          effect: 'DENY',
          permission: { name: permissionName },
          ...(amongUserIds ? { userId: { in: amongUserIds } } : {}),
        },
        select: { userId: true },
      }),
    ]);
    const deniedIds = new Set(denied.map((row) => row.userId));
    return [
      ...new Set([
        ...granted.map((row) => row.userId),
        ...inherited.map((row) => row.id),
      ]),
    ].filter((userId) => !deniedIds.has(userId));
  }
}
