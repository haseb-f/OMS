import { Module } from '@nestjs/common';
import { FixedAssetsController } from './fixed-assets.controller';
import { FixedAssetsService } from './fixed-assets.service';
import { MasterDataModule } from '../master-data/master-data.module';
import { NumberingModule } from '../numbering/numbering.module';
import { PostingEngineModule } from '../accounting/posting-engine/posting-engine.module';

@Module({
  imports: [MasterDataModule, NumberingModule, PostingEngineModule],
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService],
  exports: [FixedAssetsService],
})
export class FixedAssetsModule {}
