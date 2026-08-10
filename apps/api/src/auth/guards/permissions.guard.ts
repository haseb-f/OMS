import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { PERMISSION_CATALOG } from '../../permissions/permission-catalog';
import { PERMISSION_MODULE_KEY } from '../decorators/permission-module.decorator';
import { PERMISSION_ACTION_KEY } from '../decorators/permission-action.decorator';

const DEFAULT_ACTION_BY_METHOD: Record<string, string> = {
  GET: 'view',
  POST: 'create',
  PATCH: 'edit',
  PUT: 'edit',
  DELETE: 'delete',
};

/**
 * TASK-060 Part 8 — "Every API validates permissions. Frontend protection
 * alone is NOT enough." Runs after `JwtAuthGuard` (so `request.user` is
 * already populated) on every controller tagged with `@PermissionModule`.
 * Untagged controllers pass through unchanged — this is how backend
 * enforcement rolls out module-by-module without breaking anything not yet
 * annotated; see `PermissionModule`'s own doc comment for why a class-level
 * tag (not one decorator per method) keeps this a single reusable guard
 * instead of duplicated per-endpoint checks (Part 12).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionsResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Method-level `@PermissionModule` (rare — a controller whose routes span two matrix rows, e.g. Inventory's own "Opening Inventory" endpoint) wins over the class-level default.
    const moduleName =
      this.reflector.get<string | undefined>(
        PERMISSION_MODULE_KEY,
        context.getHandler(),
      ) ??
      this.reflector.get<string | undefined>(
        PERMISSION_MODULE_KEY,
        context.getClass(),
      );
    if (!moduleName) return true;

    const explicitAction = this.reflector.get<string | null | undefined>(
      PERMISSION_ACTION_KEY,
      context.getHandler(),
    );
    if (explicitAction === null) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user?.sub) return false;

    // SYSTEM_ADMIN bypass — unrestricted access, including actions that
    // opted into enforcement but have no registered catalog entry (the
    // fail-closed throw below would otherwise block even a super admin).
    if (await this.resolver.isSuperAdmin(user.sub)) return true;

    const action =
      explicitAction ?? DEFAULT_ACTION_BY_METHOD[request.method] ?? 'view';

    const catalogModule = PERMISSION_CATALOG.find((m) => m.key === moduleName);
    const permissionName = catalogModule?.actions.find(
      (a) => a.action === action,
    )?.name;
    if (!permissionName) {
      // A module explicitly opted into enforcement but this action isn't in
      // the catalog — fail closed rather than silently allowing an
      // unreviewed capability through.
      throw new ForbiddenException(
        `No permission is registered for "${moduleName}.${action}".`,
      );
    }

    const allowed = await this.resolver.hasPermission(user.sub, permissionName);
    if (!allowed) {
      throw new ForbiddenException(`Missing permission "${permissionName}".`);
    }
    return true;
  }
}
