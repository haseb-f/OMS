import { SetMetadata } from '@nestjs/common';

export const PERMISSION_MODULE_KEY = 'permissionModule';

/**
 * TASK-060 Part 8/12 — class-level decorator: declares which
 * `PERMISSION_CATALOG` module a controller belongs to (e.g. `sales.invoices`
 * for `SalesInvoicesController`). `PermissionsGuard` combines this with the
 * HTTP method (or an explicit `@PermissionAction` override) to know exactly
 * which permission string a request needs — one decorator per controller
 * instead of one per endpoint, so applying backend enforcement to every
 * module stays a single, mechanical, low-risk line per controller ("reuse
 * middleware," never duplicated per-method checks).
 */
export const PermissionModule = (moduleName: string) =>
  SetMetadata(PERMISSION_MODULE_KEY, moduleName);
