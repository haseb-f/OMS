import { Transform } from 'class-transformer';
import { IsEmail, IsOptional } from 'class-validator';
import { toNormalizedEmail } from '../../auth/password.util';

/** `email` is optional — defaults to the Investor's own Partner.email; required only when that's empty. */
export class InvitePortalAccountDto {
  @Transform(({ value }: { value: unknown }) =>
    value ? toNormalizedEmail(value) : value,
  )
  @IsEmail()
  @IsOptional()
  email?: string;
}
