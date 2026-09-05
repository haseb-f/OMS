import { IsOptional, IsString } from 'class-validator';

export class ArchivePaymentAttachmentDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
