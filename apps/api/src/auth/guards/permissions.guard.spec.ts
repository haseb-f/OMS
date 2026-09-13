import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsResolverService } from '../../permissions/permissions-resolver.service';
import { PERMISSION_MODULE_KEY } from '../decorators/permission-module.decorator';
import { PERMISSION_ACTION_KEY } from '../decorators/permission-action.decorator';

/**
 * TASK-062 Security Hardening Phase 12/24 — direct unit coverage of
 * `PermissionsGuard` itself: every controller-level fix in this milestone
 * (~50 controllers) depends entirely on this one guard behaving correctly,
 * yet it had no dedicated spec before this. These tests are the reusable
 * "authorization contract" the mission asked for, expressed at the
 * mechanism level rather than duplicated per-controller HTTP tests.
 */
describe('PermissionsGuard', () => {
  let resolver: {
    isSuperAdmin: jest.Mock;
    hasPermission: jest.Mock;
  };
  let guard: PermissionsGuard;

  /** Builds a fake ExecutionContext with the given class/method metadata and request. */
  function makeContext(opts: {
    classMeta?: Record<string, unknown>;
    handlerMeta?: Record<string, unknown>;
    method?: string;
    user?: { sub: string } | undefined;
  }): ExecutionContext {
    const classMeta = opts.classMeta ?? {};
    const handlerMeta = opts.handlerMeta ?? {};
    const handler = () => undefined;
    const clazz = class {};
    // Attach metadata the way SetMetadata/Reflector would store it.
    Reflect.defineMetadata = Reflect.defineMetadata ?? (() => undefined);
    for (const [key, value] of Object.entries(classMeta)) {
      Reflect.defineMetadata(key, value, clazz);
    }
    for (const [key, value] of Object.entries(handlerMeta)) {
      Reflect.defineMetadata(key, value, handler);
    }
    return {
      getHandler: () => handler,
      getClass: () => clazz,
      switchToHttp: () => ({
        getRequest: () => ({
          method: opts.method ?? 'GET',
          user: opts.user,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    resolver = {
      isSuperAdmin: jest.fn().mockResolvedValue(false),
      hasPermission: jest.fn().mockResolvedValue(false),
    };
    guard = new PermissionsGuard(
      new Reflector(),
      resolver as unknown as PermissionsResolverService,
    );
  });

  it('allows the request when the controller has no @PermissionModule at all (untagged, pre-TASK-060 rollout state)', async () => {
    const ctx = makeContext({ user: { sub: 'u1' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolver.hasPermission).not.toHaveBeenCalled();
  });

  it('denies when the user is missing from the request (JwtAuthGuard did not run / no token)', async () => {
    const ctx = makeContext({
      classMeta: { [PERMISSION_MODULE_KEY]: 'departments' },
      user: undefined,
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(false);
  });

  it('honors @SkipPermissionCheck() even on a tagged module (reference-data list reads)', async () => {
    const ctx = makeContext({
      classMeta: { [PERMISSION_MODULE_KEY]: 'departments' },
      handlerMeta: { [PERMISSION_ACTION_KEY]: null },
      user: { sub: 'u1' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolver.hasPermission).not.toHaveBeenCalled();
  });

  it('super admin bypasses even an action with no registered catalog entry', async () => {
    resolver.isSuperAdmin.mockResolvedValue(true);
    const ctx = makeContext({
      classMeta: { [PERMISSION_MODULE_KEY]: 'departments' },
      method: 'DELETE', // 'delete' action name isn't registered under 'departments'
      user: { sub: 'admin' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('fails closed with ForbiddenException when the inferred action has no matching catalog entry (non-admin)', async () => {
    const ctx = makeContext({
      classMeta: { [PERMISSION_MODULE_KEY]: 'departments' },
      method: 'DELETE', // departments' archive route uses @PermissionAction('delete') explicitly; a bare DELETE has no catalog entry
      user: { sub: 'u1' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('denies with ForbiddenException when the user lacks the required permission', async () => {
    resolver.hasPermission.mockResolvedValue(false);
    const ctx = makeContext({
      classMeta: { [PERMISSION_MODULE_KEY]: 'departments' },
      method: 'GET', // -> 'view' -> masterdata.departments.view
      user: { sub: 'u1' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(resolver.hasPermission).toHaveBeenCalledWith(
      'u1',
      'masterdata.departments.view',
    );
  });

  it('allows when the user holds the exact required permission', async () => {
    resolver.hasPermission.mockResolvedValue(true);
    const ctx = makeContext({
      classMeta: { [PERMISSION_MODULE_KEY]: 'departments' },
      method: 'PATCH', // -> 'edit' -> masterdata.departments.edit
      user: { sub: 'u1' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolver.hasPermission).toHaveBeenCalledWith(
      'u1',
      'masterdata.departments.edit',
    );
  });

  it('an explicit @PermissionAction overrides the HTTP-verb default', async () => {
    resolver.hasPermission.mockResolvedValue(true);
    const ctx = makeContext({
      classMeta: { [PERMISSION_MODULE_KEY]: 'departments' },
      handlerMeta: { [PERMISSION_ACTION_KEY]: 'delete' },
      method: 'POST', // bare POST would default to 'create'; the archive route overrides to 'delete'
      user: { sub: 'u1' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolver.hasPermission).toHaveBeenCalledWith(
      'u1',
      'masterdata.departments.archive',
    );
  });

  it('a method-level @PermissionModule overrides the class-level one', async () => {
    resolver.hasPermission.mockResolvedValue(true);
    const ctx = makeContext({
      classMeta: { [PERMISSION_MODULE_KEY]: 'employees' },
      handlerMeta: { [PERMISSION_MODULE_KEY]: 'compensation' },
      method: 'GET',
      user: { sub: 'u1' },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolver.hasPermission).toHaveBeenCalledWith(
      'u1',
      'hr.compensation.view',
    );
  });

  it.each([
    ['GET', 'masterdata.warehouses.view'],
    ['POST', 'masterdata.warehouses.create'],
    ['PATCH', 'masterdata.warehouses.edit'],
    ['PUT', 'masterdata.warehouses.edit'],
  ])(
    'infers the correct permission name for a bare %s (VIEW/CREATE/EDIT matrix)',
    async (method, expectedPermission) => {
      resolver.hasPermission.mockResolvedValue(true);
      const ctx = makeContext({
        classMeta: { [PERMISSION_MODULE_KEY]: 'warehouses' },
        method,
        user: { sub: 'u1' },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(resolver.hasPermission).toHaveBeenCalledWith(
        'u1',
        expectedPermission,
      );
    },
  );
});
