import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_POLICY } from '../../auth/password-policy';

/**
 * Admin password reset. Omit `newPassword` to let the server generate a
 * temporary password (returned once on the response). A client-supplied
 * value is still accepted so existing API callers keep working.
 */
export class ResetPasswordDto {
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_POLICY.minLength)
  @MaxLength(PASSWORD_POLICY.maxLength)
  newPassword?: string;
}
