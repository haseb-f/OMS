import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { PermissionAdministrationService } from './permission-administration.service';

/** R14 W2 — job-title templates + individual overrides administration (spec-2 §A). */
@Module({
  imports: [MasterDataModule],
  providers: [PermissionAdministrationService],
  exports: [PermissionAdministrationService],
})
export class PermissionAdministrationModule {}
