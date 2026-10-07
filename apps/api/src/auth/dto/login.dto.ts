import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { toNormalizedEmail } from '../password.util';

export class LoginDto {
  @Transform(({ value }: { value: unknown }) => toNormalizedEmail(value))
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  /**
   * R14 — retired: accepted so older clients still validate, but ignored
   * (sessions are never extended; see session-policy.md).
   */
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
