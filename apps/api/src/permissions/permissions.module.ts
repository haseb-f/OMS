import { Module } from '@nestjs/common';
import { PermissionsController } from './permissions.controller';

/**
 * TASK-060 — `PermissionsResolverService`/`PermissionsGuard` live in
 * `PermissionsCoreModule` (global, imported once in `AppModule`) since they
 * must be reachable from every business controller's `@UseGuards()`; this
 * module only owns the read-only catalog endpoint.
 */
@Module({
  controllers: [PermissionsController],
})
export class PermissionsModule {}
