import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';
import { toNormalizedEmail } from '../password.util';

export class ForgotPasswordDto {
  @Transform(({ value }: { value: unknown }) => toNormalizedEmail(value))
  @IsEmail()
  email!: string;
}
