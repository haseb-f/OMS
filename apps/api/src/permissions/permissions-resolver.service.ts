import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface CacheEntry {
  isSuperAdmin: boolean;
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
 * ad-hoc business checks like "can view all leads") from one place, without
 * changing what `getPermissions()` returns — audit/UI screens still see the
 * user's real, individually-granted permissions.
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
        select: { isSuperAdmin: true },
      }),
      this.prisma.userPermission.findMany({
        where: { userId },
        select: { permission: { select: { name: true } } },
      }),
    ]);
    const entry: CacheEntry = {
      isSuperAdmin: user?.isSuperAdmin ?? false,
      permissions: new Set(rows.map((row) => row.permission.name)),
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

  invalidate(userId: string) {
    this.cache.delete(userId);
  }

  /**
   * TASK-061 — the reverse lookup Auto Assignment needs ("which users may
   * receive this kind of work?"). Reads `UserPermission` directly rather
   * than iterating every user through `hasPermission()`, but stays the same
   * "one resolver" source of truth — no parallel permission-matching logic
   * anywhere else.
   */
  async getUsersWithPermission(permissionName: string): Promise<string[]> {
    const rows = await this.prisma.userPermission.findMany({
      where: { permission: { name: permissionName } },
      select: { userId: true },
    });
    return [...new Set(rows.map((row) => row.userId))];
  }
}
