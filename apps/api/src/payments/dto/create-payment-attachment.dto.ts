import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { emptyToUndefined } from '../../common/transforms/empty-to-undefined';

export class CreatePaymentAttachmentDto {
  /** Optional when the controller fills it from the authenticated user. */
  @IsUUID()
  @IsOptional()
  uploadedById?: string;

  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  fileName?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  attachmentType?: string;

  @Transform(emptyToUndefined)
  @IsString()
  @IsOptional()
  description?: string;
}
