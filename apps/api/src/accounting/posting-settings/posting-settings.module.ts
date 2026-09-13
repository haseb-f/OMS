import { Module } from '@nestjs/common';
import { PostingSettingsController } from './posting-settings.controller';
import { InvestorAccountingSettingsController } from './investor-accounting-settings.controller';
import { PostingSettingsService } from './posting-settings.service';

@Module({
  controllers: [
    PostingSettingsController,
    InvestorAccountingSettingsController,
  ],
  providers: [PostingSettingsService],
  exports: [PostingSettingsService],
})
export class PostingSettingsModule {}
