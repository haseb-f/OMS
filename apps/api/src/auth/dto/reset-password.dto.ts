import { IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_POLICY } from '../password-policy';

export class ResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(PASSWORD_POLICY.minLength)
  @MaxLength(PASSWORD_POLICY.maxLength)
  newPassword!: string;
}
