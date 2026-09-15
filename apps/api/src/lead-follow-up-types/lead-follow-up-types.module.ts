import { Module } from '@nestjs/common';
import { LeadFollowUpTypesController } from './lead-follow-up-types.controller';
import { LeadFollowUpTypesService } from './lead-follow-up-types.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [MasterDataModule, NumberingModule],
  controllers: [LeadFollowUpTypesController],
  providers: [LeadFollowUpTypesService],
  exports: [LeadFollowUpTypesService],
})
export class LeadFollowUpTypesModule {}
