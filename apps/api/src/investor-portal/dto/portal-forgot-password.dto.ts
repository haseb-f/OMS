import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { toNormalizedEmail } from '../../auth/password.util';

export class PortalForgotPasswordDto {
  @Transform(({ value }: { value: unknown }) => toNormalizedEmail(value))
  @IsEmail()
  email!: string;
}
