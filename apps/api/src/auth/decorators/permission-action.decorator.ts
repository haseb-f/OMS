import { SetMetadata } from '@nestjs/common';

export const PERMISSION_ACTION_KEY = 'permissionAction';

/**
 * TASK-060 — method-level override for `PermissionsGuard`'s default HTTP
 * verb -> action inference (GET -> view, POST -> create, PATCH/PUT -> edit,
 * DELETE -> delete). Required on every non-CRUD workflow route — `.post()`
 * for `POST :id/post`, `.reverse()` for `POST :id/reverse`, `.confirm()`,
 * `.approve()`, `.cancel()`, `.print()`, `.export()`, `.import()` — so the
 * guard checks the action that route actually performs, never the generic
 * "create" a bare POST would otherwise infer.
 */
export const PermissionAction = (action: string) =>
  SetMetadata(PERMISSION_ACTION_KEY, action);

/** Marks an endpoint as never permission-checked (e.g. a workflow's own read-only sub-resource that should follow the parent's `view`, or a route this task's scope doesn't cover) — same "explicit opt-out" shape as `@PermissionAction`, so the guard's default-allow-when-undeclared behavior is a documented choice, not a silent gap. */
export const SkipPermissionCheck = () =>
  SetMetadata(PERMISSION_ACTION_KEY, null);
