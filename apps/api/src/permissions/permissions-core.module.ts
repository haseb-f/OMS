import { Global, Module } from '@nestjs/common';
import { PermissionsResolverService } from './permissions-resolver.service';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

/**
 * TASK-060 — makes `PermissionsResolverService`/`PermissionsGuard`
 * resolvable from any controller's `@UseGuards(JwtAuthGuard, PermissionsGuard)`
 * without every business module importing this one, mirroring how
 * `PrismaModule`/`JwtModule` are already globally registered (see
 * `prisma.module.ts`, `auth.module.ts`) so `JwtAuthGuard` works the same way
 * today. Imported exactly once, in `AppModule`.
 */
@Global()
@Module({
  providers: [PermissionsResolverService, PermissionsGuard],
  exports: [PermissionsResolverService, PermissionsGuard],
})
export class PermissionsCoreModule {}
