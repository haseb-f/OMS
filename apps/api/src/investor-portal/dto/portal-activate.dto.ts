import { IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_POLICY } from '../../auth/password-policy';

/** Used for both first-time activation (Invite) and forgot-password reset — same single-use token mechanism. */
export class PortalActivateDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(PASSWORD_POLICY.minLength)
  @MaxLength(PASSWORD_POLICY.maxLength)
  newPassword!: string;
}
