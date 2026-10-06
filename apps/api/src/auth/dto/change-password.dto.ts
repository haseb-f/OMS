import { IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_POLICY } from '../password-policy';

/** Self-service password change (own account, current password required). */
export class ChangePasswordDto {
  @IsString()
  @MaxLength(PASSWORD_POLICY.maxLength)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_POLICY.minLength)
  @MaxLength(PASSWORD_POLICY.maxLength)
  newPassword!: string;
}
