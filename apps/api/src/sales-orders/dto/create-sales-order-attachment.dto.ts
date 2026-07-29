import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateSalesOrderAttachmentDto {
  @IsUUID()
  uploadedById!: string;

  @IsString()
  @IsNotEmpty()
  fileUrl!: string;

  @IsString()
  @IsOptional()
  fileName?: string;

  @IsString()
  @IsNotEmpty()
  attachmentType!: string;

  @IsString()
  @IsOptional()
  description?: string;
}
