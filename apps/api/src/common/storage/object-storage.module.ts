import { Global, Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';

@Global()
@Module({
  controllers: [AttachmentsController],
  providers: [ObjectStorageService, AttachmentsService],
  exports: [ObjectStorageService, AttachmentsService],
})
export class ObjectStorageModule {}
