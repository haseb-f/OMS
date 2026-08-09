import { Module } from '@nestjs/common';
import { PostingSettingsController } from './posting-settings.controller';
import { PostingSettingsService } from './posting-settings.service';

@Module({
  controllers: [PostingSettingsController],
  providers: [PostingSettingsService],
  exports: [PostingSettingsService],
})
export class PostingSettingsModule {}
