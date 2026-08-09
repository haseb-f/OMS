import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Same url-based, metadata-only shape as `CreatePaymentAttachmentDto` — no
 * file-upload backend exists anywhere in this codebase yet, so the caller
 * supplies a URL. Unlike Payment's attachment DTO, `uploadedById` is never
 * taken from the request body — ProductsController reads it from
 * `@CurrentUser()` instead, now that Products is behind `JwtAuthGuard`.
 */
export class CreateProductAttachmentDto {
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
