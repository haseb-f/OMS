import { IsString, MinLength } from 'class-validator';

/** Used for both first-time activation (Invite) and forgot-password reset — same single-use token mechanism. */
export class PortalActivateDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
