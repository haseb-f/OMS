import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Admin password reset. Omit `newPassword` to let the server generate a
 * temporary password (returned once on the response). A client-supplied
 * value is still accepted so existing API callers keep working.
 */
export class ResetPasswordDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  newPassword?: string;
}
