import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface CacheEntry {
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
 */
@Injectable()
export class PermissionsResolverService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async getPermissions(userId: string): Promise<Set<string>> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.permissions;
    }

    const rows = await this.prisma.userPermission.findMany({
      where: { userId },
      select: { permission: { select: { name: true } } },
    });
    const permissions = new Set(rows.map((row) => row.permission.name));
    this.cache.set(userId, {
      permissions,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return permissions;
  }

  async hasPermission(
    userId: string,
    permissionName: string,
  ): Promise<boolean> {
    const permissions = await this.getPermissions(userId);
    return permissions.has(permissionName);
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
