import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { toNormalizedEmail } from '../../auth/password.util';

export class PortalLoginDto {
  @Transform(({ value }: { value: unknown }) => toNormalizedEmail(value))
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
