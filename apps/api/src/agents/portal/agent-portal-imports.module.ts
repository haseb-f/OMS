import { Module } from '@nestjs/common';
import { ImportCenterModule } from '../../import-center/import-center.module';
import { AgentPermissionGuard } from '../common/agent-permission.guard';
import { AgentPortalImportsController } from './agent-portal-imports.controller';

/** R15 (D15-16) — agent users' lead / order imports (`/agent-portal/imports/*`). */
@Module({
  imports: [ImportCenterModule],
  controllers: [AgentPortalImportsController],
  providers: [AgentPermissionGuard],
})
export class AgentPortalImportsModule {}
