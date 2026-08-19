import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PermissionModule } from '../auth/decorators/permission-module.decorator';
import { PermissionAction } from '../auth/decorators/permission-action.decorator';
import { groupPermissionCatalog } from './permission-catalog';

/**
 * TASK-060 — read-only: the Permission Matrix UI's entire data source.
 * Permission rows themselves are fully seed-managed from `PERMISSION_CATALOG`
 * (never created/edited via API) — granting/revoking happens per-user, see
 * `UsersController`'s `/users/:id/permissions` endpoints.
 */
@Controller('permissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@PermissionModule('settings')
export class PermissionsController {
  @Get('catalog')
  @PermissionAction('manage')
  getCatalog() {
    return groupPermissionCatalog();
  }
}
