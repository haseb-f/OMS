import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { PermissionsCoreModule } from '../permissions/permissions-core.module';
import { NumberingModule } from '../numbering/numbering.module';
import { StatusDefinitionsModule } from '../status-definitions/status-definitions.module';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowStatusResolverService } from './workflow-status-resolver.service';
import { WorkflowController } from './workflow.controller';

@Module({
  imports: [
    MasterDataModule,
    PermissionsCoreModule,
    NumberingModule,
    StatusDefinitionsModule,
  ],
  controllers: [WorkflowController],
  providers: [WorkflowEngineService, WorkflowStatusResolverService],
  exports: [
    WorkflowEngineService,
    WorkflowStatusResolverService,
    StatusDefinitionsModule,
  ],
})
export class WorkflowModule {}
