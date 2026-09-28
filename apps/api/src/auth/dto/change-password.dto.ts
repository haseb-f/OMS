import { IsString, MaxLength, MinLength } from 'class-validator';

/** Self-service password change (own account, current password required). */
export class ChangePasswordDto {
  @IsString()
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}
