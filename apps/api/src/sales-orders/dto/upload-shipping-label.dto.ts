import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class UploadShippingLabelDto {
  @IsUUID()
  uploadedById!: string;

  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @IsString()
  @IsOptional()
  fileName?: string;

  @IsString()
  @IsOptional()
  description?: string;
}
